import type { ConversationItem } from "@/types";

// Shared parsing/classification for Claude Code tool calls. Used by both the
// chat-history loader (`claudeCodeConversation.ts`) and the live streaming
// handler (`useThreadMessaging.ts`) so the two paths render tools consistently.

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function prettyJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** First non-empty trimmed string among the given keys of a record. */
export function firstString(source: JsonRecord | null, keys: string[]): string {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/**
 * Parse a JSON object from a string (e.g. accumulated `input_json_delta`
 * partial_json). Returns null on failure or when the result isn't an object,
 * so callers can retry as more chunks arrive.
 */
export function parseJsonObject(value: string): JsonRecord | null {
  if (!value) {
    return null;
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * Flatten a `tool_result` content block into plain text. Claude Code results
 * may carry content as a string, an array of text blocks, or arbitrary JSON.
 */
export function toolResultText(block: JsonRecord): string {
  const content = block.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return prettyJson(content);
  }
  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      const record = asRecord(item);
      return stringValue(record?.text) || prettyJson(item);
    })
    .filter(Boolean)
    .join("\n\n");
}

export type ClassifiedTool = {
  toolType: string;
  title: string;
  detail: string;
};

/**
 * Map a Claude Code tool name + parsed input to a ConversationItem tool
 * `toolType` / `title` / `detail`. The title keeps the `Tool: Claude Code/<Name>`
 * shape so `toolNameFromTitle()` can recover the name for labels and icons.
 *
 * `taskcreate` / `taskupdate` / `todowrite` are intentionally left as generic
 * `claudeCodeToolCall` here — the history loader upgrades them to `plan` with
 * aggregated steps (it owns the cross-message task map).
 */
export function classifyClaudeCodeTool(
  name: string,
  input: JsonRecord,
): ClassifiedTool {
  const normalized = name.toLowerCase();

  if (normalized === "bash") {
    return {
      toolType: "commandExecution",
      title: `Command: ${firstString(input, ["command", "cmd"]) || name}`,
      detail: firstString(input, ["cwd", "workdir", "working_directory"]),
    };
  }

  if (normalized === "websearch" || normalized === "webfetch") {
    return {
      toolType: "webSearch",
      title: `Tool: Claude Code/${name}`,
      detail: prettyJson(input),
    };
  }

  if (normalized === "read" || normalized === "view_image") {
    return {
      toolType: "claudeCodeToolCall",
      title: `Tool: Claude Code/${name}`,
      detail: firstString(input, ["file_path", "path", "filename", "url"]),
    };
  }

  if (
    normalized === "write" ||
    normalized === "edit" ||
    normalized === "multiedit"
  ) {
    // File-mutating tools render as a Codex-style "File changes" row with an
    // inline diff — see `buildClaudeCodeFileChanges` for the diff body.
    return {
      toolType: "fileChange",
      title: `Tool: Claude Code/${name}`,
      detail: firstString(input, ["file_path", "path", "filename"]),
    };
  }

  if (normalized === "notebookedit") {
    return {
      toolType: "claudeCodeToolCall",
      title: `Tool: Claude Code/${name}`,
      detail: firstString(input, ["file_path", "path", "notebook_path", "filename"]),
    };
  }

  if (normalized === "grep" || normalized === "glob") {
    return {
      toolType: "claudeCodeToolCall",
      title: `Tool: Claude Code/${name}`,
      detail: firstString(input, ["pattern", "query", "regexp", "path", "output_mode"]),
    };
  }

  return {
    toolType: "claudeCodeToolCall",
    title: `Tool: Claude Code/${name}`,
    detail:
      firstString(input, ["subject", "description", "prompt", "query"]) ||
      prettyJson(input),
  };
}

function normalizedToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isClaudeCodeUserQuestionTool(name: string): boolean {
  const normalized = normalizedToolName(name);
  return (
    normalized === "askuser" ||
    normalized === "askuserquestion" ||
    normalized === "requestuserinput" ||
    normalized === "requestuserinputtool" ||
    normalized === "userinput" ||
    normalized === "askhuman"
  );
}

function optionFromValue(value: unknown) {
  if (typeof value === "string") {
    const label = value.trim();
    return label ? { label, description: "" } : null;
  }
  const record = asRecord(value);
  const label = firstString(record, ["label", "title", "value", "text"]);
  const description = firstString(record, ["description", "detail", "subtitle"]);
  return label || description ? { label: label || description, description } : null;
}

function answerTextFromResult(resultText: string): string[] {
  const trimmed = resultText.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = parseJsonObject(trimmed);
  if (parsed) {
    const direct = firstString(parsed, ["answer", "response", "text", "value"]);
    if (direct) {
      return [direct];
    }
    const answers = parsed.answers;
    if (Array.isArray(answers)) {
      return answers
        .map((answer) => (typeof answer === "string" ? answer.trim() : prettyJson(answer).trim()))
        .filter(Boolean);
    }
  }
  return [trimmed];
}

function questionFromRecord(record: JsonRecord, index: number, answers: string[]) {
  const id = firstString(record, ["id", "question_id", "questionId"]) || `question-${index + 1}`;
  const header = firstString(record, ["header", "title", "label"]);
  const question =
    firstString(record, ["question", "prompt", "message", "text", "description"]) ||
    header ||
    "Input requested";
  const options = Array.isArray(record.options)
    ? record.options.map(optionFromValue).filter((option) => option !== null)
    : [];
  return {
    id,
    header,
    question,
    answers,
    ...(options.length ? { options } : {}),
  };
}

export function buildClaudeCodeUserInputItem(params: {
  id: string;
  input: JsonRecord;
  resultText?: string;
}): Extract<ConversationItem, { kind: "userInput" }> {
  const answers = answerTextFromResult(params.resultText ?? "");
  const rawQuestions = Array.isArray(params.input.questions)
    ? params.input.questions
    : Array.isArray(params.input.prompts)
      ? params.input.prompts
      : null;
  const questions = rawQuestions
    ? rawQuestions
        .map((value, index) => {
          const record = asRecord(value);
          if (record) {
            return questionFromRecord(record, index, index === 0 ? answers : []);
          }
          const question = typeof value === "string" ? value.trim() : prettyJson(value).trim();
          return {
            id: `question-${index + 1}`,
            header: "",
            question: question || "Input requested",
            answers: index === 0 ? answers : [],
          };
        })
        .filter((question) => question.question.trim())
    : [questionFromRecord(params.input, 0, answers)];

  return {
    id: params.id,
    kind: "userInput",
    status: answers.length ? "answered" : "requested",
    questions,
  };
}

function extractClaudeCodeTextQuestion(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();
  const waitsForUser =
    normalized.includes("请回复") ||
    normalized.includes("请选择") ||
    normalized.includes("请回答") ||
    normalized.includes("等我回答") ||
    normalized.includes("等您回答") ||
    normalized.includes("收到你的") ||
    normalized.includes("收到您") ||
    lower.includes("please reply") ||
    lower.includes("please choose") ||
    lower.includes("wait for your") ||
    lower.includes("after your answer");
  if (!waitsForUser) {
    return null;
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const questionLine = lines.find((line) => /[?？]$/.test(line)) ?? lines[0];
  return questionLine || "Input requested";
}

export function buildClaudeCodeTextUserInputItem(params: {
  id: string;
  text: string;
}): Extract<ConversationItem, { kind: "userInput" }> | null {
  const question = extractClaudeCodeTextQuestion(params.text);
  if (!question) {
    return null;
  }
  return {
    id: params.id,
    kind: "userInput",
    status: "requested",
    questions: [
      {
        id: "question-1",
        header: "",
        question,
        answers: [],
      },
    ],
  };
}

// ---- File-change diff generation (Write / Edit / MultiEdit) ----
//
// Mirrors how Codex renders `apply_patch`: a `fileChange` tool item carries a
// `changes: [{ path, diff }]` array, and `ToolRow` renders each `diff` through
// `PierreDiffBlock`. We synthesize a git-style unified diff from the tool input
// so Write/Edit/MultiEdit get the same inline diff view.

type DiffLine = { prefix: " " | "-" | "+"; text: string };

function splitLinesKeepTrailing(value: string): string[] {
  if (!value) {
    return [];
  }
  const lines = value.split("\n");
  // A trailing newline produces a phantom empty last element; drop it so we
  // don't render an extra empty context/add line.
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Line-level diff between the Edit `old_string` and `new_string`. Uses a plain
 * LCS table so common lines render as unchanged context and only the real
 * edits show as +/-. Falls back to "remove all old / add all new" when the
 * inputs are too large for an O(n*m) table.
 */
function lineLevelDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLinesKeepTrailing(oldText);
  const newLines = splitLinesKeepTrailing(newText);
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0) {
    return newLines.map((text) => ({ prefix: "+", text }));
  }
  if (m === 0) {
    return oldLines.map((text) => ({ prefix: "-", text }));
  }
  if (n * m > 1_500_000) {
    return [
      ...oldLines.map((text) => ({ prefix: "-" as const, text })),
      ...newLines.map((text) => ({ prefix: "+" as const, text })),
    ];
  }

  const dp: Int32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) {
    dp[i] = new Int32Array(m + 1);
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({ prefix: " ", text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ prefix: "-", text: oldLines[i] });
      i += 1;
    } else {
      out.push({ prefix: "+", text: newLines[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ prefix: "-", text: oldLines[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ prefix: "+", text: newLines[j] });
    j += 1;
  }
  return out;
}

/** Assemble a git-style unified diff with one `@@` hunk per provided body. */
function buildUnifiedDiff(path: string, hunks: DiffLine[][]): string {
  const lines = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ];
  for (const hunk of hunks) {
    if (hunk.length === 0) {
      continue;
    }
    lines.push("@@");
    for (const diffLine of hunk) {
      lines.push(`${diffLine.prefix}${diffLine.text}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build the `changes` array for a file-mutating Claude Code tool, or `null`
 * when there is nothing to diff (no path / empty content). Write → all
 * additions (we never see the prior content); Edit → LCS diff of old→new
 * string; MultiEdit → one hunk per edit.
 */
export function buildClaudeCodeFileChanges(
  name: string,
  input: JsonRecord,
): { path: string; kind?: string; diff?: string }[] | null {
  const normalized = name.toLowerCase();
  if (normalized !== "write" && normalized !== "edit" && normalized !== "multiedit") {
    return null;
  }
  const path = firstString(input, ["file_path", "path", "filename"]);
  if (!path) {
    return null;
  }

  if (normalized === "write") {
    const content = stringValue(input.content);
    if (!content) {
      return null;
    }
    const body = splitLinesKeepTrailing(content).map((text) => ({
      prefix: "+" as const,
      text,
    }));
    if (body.length === 0) {
      return null;
    }
    return [{ path, kind: "add", diff: buildUnifiedDiff(path, [body]) }];
  }

  if (normalized === "edit") {
    const oldStr = stringValue(input.old_string);
    const newStr = stringValue(input.new_string);
    if (!oldStr && !newStr) {
      return null;
    }
    const body = lineLevelDiff(oldStr, newStr);
    if (body.length === 0) {
      return null;
    }
    return [{ path, diff: buildUnifiedDiff(path, [body]) }];
  }

  // multiedit: one hunk per edit, all under the same path.
  const edits = Array.isArray(input.edits) ? input.edits : [];
  const hunks: DiffLine[][] = [];
  for (const edit of edits) {
    const rec = asRecord(edit);
    if (!rec) {
      continue;
    }
    const oldStr = stringValue(rec.old_string);
    const newStr = stringValue(rec.new_string);
    if (!oldStr && !newStr) {
      continue;
    }
    const body = lineLevelDiff(oldStr, newStr);
    if (body.length > 0) {
      hunks.push(body);
    }
  }
  if (hunks.length === 0) {
    return null;
  }
  return [{ path, diff: buildUnifiedDiff(path, hunks) }];
}

/**
 * Best-effort readable output for a Claude Code tool, shown in the expandable
 * area of a ToolRow. File-mutating tools surface the new content from their
 * input (the tool_result is usually just a confirmation); read/search/shell
 * tools surface the result text.
 */
export function claudeCodeToolOutput(
  name: string,
  input: JsonRecord,
  resultText: string,
): string {
  const normalized = name.toLowerCase();

  if (normalized === "write") {
    return stringValue(input.content);
  }
  if (normalized === "edit") {
    return stringValue(input.new_string);
  }
  if (normalized === "multiedit") {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    return edits
      .map((edit) => stringValue(asRecord(edit)?.new_string))
      .filter(Boolean)
      .join("\n\n---\n\n");
  }
  if (normalized === "notebookedit") {
    return stringValue(input.new_source) || stringValue(input.new_string);
  }

  return resultText;
}

/** Build a complete tool item (minus output/status, which arrive later).
 * `includeChanges` (default true) attaches the inline diff for Write/Edit/
 * MultiEdit; pass false while the `input_json_delta` is still streaming so a
 * partial diff doesn't flicker, then re-build with the finalized input. */
export function buildClaudeCodeToolItem(params: {
  id: string;
  name: string;
  input: JsonRecord;
  status?: string;
  output?: string;
  includeChanges?: boolean;
}): Extract<ConversationItem, { kind: "tool" }> {
  const { toolType, title, detail } = classifyClaudeCodeTool(
    params.name,
    params.input,
  );
  const base = {
    id: params.id,
    kind: "tool" as const,
    toolType,
    title,
    detail,
    status: params.status,
    ...(params.output ? { output: params.output } : {}),
  };
  if (params.includeChanges === false) {
    return base;
  }
  const changes = buildClaudeCodeFileChanges(params.name, params.input);
  return changes && changes.length > 0 ? { ...base, changes } : base;
}
