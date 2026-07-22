import type { ConversationItem } from "../types";
import { parseCollabToolCallItem } from "./threadItems.collab";
import { asNumber, asString, normalizeStringList } from "./threadItems.shared";

const INTERNAL_USER_MESSAGE_LINE_PATTERN =
  /^<\s*(?:turn_aborted|system[-_]reminder)\b/i;
const INTERNAL_IMAGE_MARKER_OPEN_PATTERN =
  /<image\b(?=[^>]*\bname=)(?=[^>]*\bpath=)[^>]*>/gi;
const INTERNAL_IMAGE_MARKER_CLOSE_PATTERN = /<\/image>/gi;
const INTERNAL_IMAGE_MARKER_PATH_PATTERN =
  /<image\b(?=[^>]*\bname=)(?=[^>]*\bpath=)[^>]*\bpath=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
const INTERRUPTED_TURN_BLOCK_PATTERN =
  /\n?<turn_aborted>\s*The user interrupted the previous turn on purpose\.[\s\S]*?(?:<\/turn_aborted>\s*)?$/i;
const FILES_MENTIONED_WRAPPER_PATTERN =
  /(?:^|\n)[ \t]*# Files mentioned by the user:[\s\S]*?[ \t]*##\s*My request for[^:\n]*:[ \t]*\n?/gi;

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    const text = asString(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function getSavedImagePath(item: Record<string, unknown>) {
  return firstNonEmptyString(item.saved_path, item.savedPath);
}

function decodeInternalImagePath(value: string) {
  return value
    .replace(/&quot;|&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function imagePathsFromInternalMarkers(text: string) {
  const paths: string[] = [];
  for (const match of text.matchAll(INTERNAL_IMAGE_MARKER_PATH_PATTERN)) {
    const path = decodeInternalImagePath(match[1] ?? match[2] ?? match[3] ?? "");
    if (path) {
      paths.push(path);
    }
  }
  return paths;
}

function extractToolOutput(item: Record<string, unknown>) {
  return firstNonEmptyString(
    item.aggregatedOutput,
    item.aggregated_output,
    item.output,
    item.stdout,
    item.stderr,
    item.result,
  );
}

function getFunctionCallId(item: Record<string, unknown>) {
  return firstNonEmptyString(item.callId, item.call_id, item.id);
}

function formatFunctionCallArguments(value: unknown) {
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}

function parseFunctionCallArguments(value: unknown) {
  const raw = asString(value);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getFunctionCallArgumentsSource(item: Record<string, unknown>) {
  return item.arguments ?? item.args ?? item.input;
}

function getFunctionCallArguments(item: Record<string, unknown>) {
  return parseFunctionCallArguments(getFunctionCallArgumentsSource(item));
}

function getFirstStringField(source: Record<string, unknown> | null, keys: string[]) {
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

function getFunctionCallDetail(item: Record<string, unknown>) {
  return formatFunctionCallArguments(getFunctionCallArgumentsSource(item));
}

function buildExecCommandItem(
  item: Record<string, unknown>,
  outputOverride?: string,
): ConversationItem | null {
  const id = getFunctionCallId(item);
  if (!id) {
    return null;
  }
  const args = getFunctionCallArguments(item);
  const command = firstNonEmptyString(args?.cmd, item.command, item.cmd);
  const cwd = firstNonEmptyString(args?.workdir, args?.cwd, item.workdir, item.cwd);
  const output = outputOverride ?? extractToolOutput(item);
  return {
    id,
    kind: "tool",
    toolType: "commandExecution",
    title: command ? `Command: ${command}` : "Command",
    detail: cwd,
    status: output ? "completed" : asString(item.status ?? "inProgress"),
    output,
    preserveCommandOutput: true,
  };
}

function buildWriteStdinItem(item: Record<string, unknown>): ConversationItem | null {
  const id = getFunctionCallId(item);
  if (!id) {
    return null;
  }
  const args = getFunctionCallArguments(item);
  const chars = asString(args?.chars ?? item.chars);
  const sessionId = firstNonEmptyString(args?.session_id, args?.sessionId, item.session_id, item.sessionId);
  const escapedChars = chars
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  const preview = escapedChars || "(poll)";
  return {
    id,
    kind: "tool",
    toolType: "functionCall",
    title: "Tool: write_stdin",
    detail: [sessionId ? `session ${sessionId}` : "", preview].filter(Boolean).join(" · "),
    status: asString(item.status ?? "completed"),
    output: "",
    suppressToolOutput: true,
  };
}

function isEmptyWriteStdinCall(item: Record<string, unknown>) {
  const name = firstNonEmptyString(item.name, item.toolName, item.tool_name);
  if (name !== "write_stdin") {
    return false;
  }
  const args = getFunctionCallArguments(item);
  return !asString(args?.chars ?? item.chars);
}

function buildSearchToolItem(
  item: Record<string, unknown>,
  name: string,
  outputOverride?: string,
): ConversationItem | null {
  const id = getFunctionCallId(item);
  if (!id) {
    return null;
  }
  const args = getFunctionCallArguments(item);
  const query = getFirstStringField(args, ["query", "q", "pattern", "text"]);
  const target = getFirstStringField(args, ["path", "file", "filename", "ref_id", "refId", "url"]);
  const output = outputOverride ?? extractToolOutput(item);
  return {
    id,
    kind: "tool",
    toolType: name === "image_query" ? "imageView" : "mcpToolCall",
    title: `Tool: search / ${name}`,
    detail: query || target || getFunctionCallDetail(item),
    status: output ? "completed" : asString(item.status ?? "inProgress"),
    output,
  };
}

function buildReadToolItem(
  item: Record<string, unknown>,
  name: string,
  outputOverride?: string,
): ConversationItem | null {
  const id = getFunctionCallId(item);
  if (!id) {
    return null;
  }
  const args = getFunctionCallArguments(item);
  const target = getFirstStringField(args, ["path", "file", "filename", "ref_id", "refId", "url"]);
  const output = outputOverride ?? extractToolOutput(item);
  return {
    id,
    kind: "tool",
    toolType: name === "view_image" ? "imageView" : "mcpToolCall",
    title: `Tool: read / ${name}`,
    detail: target || getFunctionCallDetail(item),
    status: output ? "completed" : asString(item.status ?? "inProgress"),
    output,
  };
}

function buildPatchToolItem(
  item: Record<string, unknown>,
  outputOverride?: string,
): ConversationItem | null {
  const id = getFunctionCallId(item);
  if (!id) {
    return null;
  }
  const patch = firstNonEmptyString(item.input, item.arguments, item.args);
  const output = outputOverride ?? extractToolOutput(item);
  const changes = splitUnifiedDiffByFile(patch);
  const patchChanges = changes.length > 0 ? changes : parseApplyPatchChanges(patch);
  return {
    id,
    kind: "tool",
    toolType: "fileChange",
    title: "File changes",
    detail: patchChanges.length > 0 ? patchChanges.map((change) => change.path).join(", ") : "apply_patch",
    status: asString(item.status ?? (output ? "completed" : "inProgress")),
    output: patch || output,
    changes: patchChanges,
  };
}

type PlanStepStatus = "pending" | "inProgress" | "completed";

function normalizePlanStepStatusValue(value: unknown): PlanStepStatus {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.replace(/[_\s-]/g, "").toLowerCase();
  if (normalized === "inprogress") {
    return "inProgress";
  }
  if (normalized === "completed") {
    return "completed";
  }
  return "pending";
}

function extractPlanFromArgs(
  args: Record<string, unknown> | null,
): { explanation: string | null; steps: { step: string; status: PlanStepStatus }[] } | null {
  if (!args) {
    return null;
  }
  const rawStepsSource = Array.isArray(args.plan)
    ? args.plan
    : Array.isArray(args.steps)
      ? args.steps
      : Array.isArray(args.items)
        ? args.items
        : Array.isArray(args.entries)
          ? args.entries
          : null;
  const steps = Array.isArray(rawStepsSource)
    ? rawStepsSource
        .map((entry): { step: string; status: PlanStepStatus } | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const step = asString(record.step ?? record.text ?? record.title);
          if (!step) {
            return null;
          }
          return { step, status: normalizePlanStepStatusValue(record.status) };
        })
        .filter((entry): entry is { step: string; status: PlanStepStatus } => Boolean(entry))
    : [];
  const rawExplanation = args.explanation ?? args.note;
  const explanation =
    typeof rawExplanation === "string" && rawExplanation.trim()
      ? rawExplanation.trim()
      : null;
  if (!steps.length && !explanation) {
    return null;
  }
  return { explanation, steps };
}

function buildPlanToolItem(
  item: Record<string, unknown>,
  outputOverride?: string,
): ConversationItem | null {
  const id = getFunctionCallId(item);
  if (!id) {
    return null;
  }
  const args = getFunctionCallArguments(item);
  const output = outputOverride ?? extractToolOutput(item);
  const plan = extractPlanFromArgs(args);
  return {
    id,
    kind: "tool",
    toolType: "plan",
    title: "Plan",
    detail: getFirstStringField(args, ["explanation", "status"]),
    status: asString(item.status ?? (output ? "completed" : "inProgress")),
    output: output || getFunctionCallDetail(item),
    plan: plan ?? undefined,
  };
}

function buildFunctionCallItem(
  item: Record<string, unknown>,
  outputOverride?: string,
): ConversationItem | null {
  const id = getFunctionCallId(item);
  const name = firstNonEmptyString(item.name, item.toolName, item.tool_name);
  if (!id || !name) {
    return null;
  }
  if (name === "exec_command") {
    return buildExecCommandItem(item, outputOverride);
  }
  if (name === "write_stdin") {
    return buildWriteStdinItem(item);
  }
  if (name === "apply_patch") {
    return buildPatchToolItem(item, outputOverride);
  }
  if (name === "update_plan") {
    return buildPlanToolItem(item, outputOverride);
  }
  if (
    name === "search_query" ||
    name === "image_query" ||
    name === "tool_search_tool" ||
    name === "find" ||
    name.toLowerCase().includes("search")
  ) {
    return buildSearchToolItem(item, name, outputOverride);
  }
  if (
    name === "open" ||
    name === "view_image" ||
    name.toLowerCase().includes("read")
  ) {
    return buildReadToolItem(item, name, outputOverride);
  }
  const output = outputOverride ?? extractToolOutput(item);
  return {
    id,
    kind: "tool",
    toolType: "functionCall",
    title: `Tool: ${name}`,
    detail: getFunctionCallDetail(item),
    status: output ? "completed" : asString(item.status ?? "inProgress"),
    output,
  };
}

function buildFunctionCallOutputItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const id = getFunctionCallId(item);
  if (!id) {
    return null;
  }
  return {
    id,
    kind: "tool",
    toolType: "functionCall",
    title: "Tool result",
    detail: "",
    status: "completed",
    output: extractToolOutput(item),
  };
}

function imageSrcFromResponseContentEntry(entry: Record<string, unknown>) {
  const savedPath = getSavedImagePath(entry);
  if (savedPath) {
    return savedPath;
  }
  const imageUrl = entry.image_url;
  if (typeof imageUrl === "string" && imageUrl.trim()) {
    return imageUrl.trim();
  }
  if (imageUrl && typeof imageUrl === "object" && !Array.isArray(imageUrl)) {
    const url = asString((imageUrl as Record<string, unknown>).url);
    if (url.trim()) {
      return url.trim();
    }
  }
  const fileId = asString(entry.file_id);
  if (fileId.trim()) {
    return fileId.trim();
  }
  const b64 = asString(entry.result ?? entry.base64);
  if (b64.trim()) {
    const mimeType = asString(entry.mime_type ?? entry.mimeType ?? "image/png").trim() || "image/png";
    return `data:${mimeType};base64,${b64.trim()}`;
  }
  return "";
}

function imagesFromResponseContent(content: unknown) {
  if (!Array.isArray(content)) {
    return [];
  }
  const markerPaths: string[] = [];
  const inputImageUrls: string[] = [];
  const otherImageUrls: string[] = [];
  for (const entry of content) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const type = asString(record.type).toLowerCase();
    if (type === "text" || type === "input_text") {
      markerPaths.push(
        ...imagePathsFromInternalMarkers(firstNonEmptyString(record.text, record.input_text)),
      );
      continue;
    }
    if (
      type !== "image" &&
      type !== "output_image" &&
      type !== "input_image" &&
      type !== "image_url"
    ) {
      continue;
    }
    const image = imageSrcFromResponseContentEntry(record);
    if (!image) {
      continue;
    }
    if (type === "input_image") {
      inputImageUrls.push(image);
    } else {
      otherImageUrls.push(image);
    }
  }
  // <image> markers in input_text and input_image data URLs are paired: each
  // marker corresponds to the next input_image entry. When both exist, prefer
  // the marker's file path and drop the redundant base64 data URL so we don't
  // render the same preview twice.
  const pairedInputImageCount = Math.min(markerPaths.length, inputImageUrls.length);
  const standaloneInputImages = inputImageUrls.slice(pairedInputImageCount);
  return [...markerPaths, ...standaloneInputImages, ...otherImageUrls];
}

function mergeMessageImages(...groups: Array<string[] | undefined>) {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group) {
      continue;
    }
    for (const image of group) {
      const trimmed = image.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged;
}

function buildAgentMessageItem(item: Record<string, unknown>, id: string): ConversationItem {
  const textFromContent = textFromResponseContentForRole(item.content, "assistant");
  const text = textFromContent || asString(item.text);
  const images = mergeMessageImages(
    normalizeStringList(item.images),
    imagesFromResponseContent(item.content),
  );
  return {
    id,
    kind: "message",
    role: "assistant",
    text,
    images: images.length > 0 ? images : undefined,
  };
}

function stripInternalUserMessageText(text: string) {
  if (!text) {
    return "";
  }
  const normalized = text.includes("\r\n") ? text.replace(/\r\n/g, "\n") : text;
  if (
    !normalized.includes("<") &&
    !normalized.includes("# AGENTS.md") &&
    !normalized.includes("# Files mentioned by the user:")
  ) {
    return normalized.trim();
  }
  const stripped = normalized
    .replace(
      /(?:^|\n)# AGENTS\.md[\s\S]*?<\/INSTRUCTIONS>\s*(?=\n|$)/gi,
      "\n",
    )
    .replace(
      /(?:^|\n)<environment_context>[\s\S]*?<\/environment_context>\s*(?=\n|$)/gi,
      "\n",
    )
    .replace(
      /(?:^|\n)<collaboration_mode>[\s\S]*?<\/collaboration_mode>\s*(?=\n|$)/gi,
      "\n",
    )
    .replace(
      /(?:^|\n)<skills_instructions>[\s\S]*?<\/skills_instructions>\s*(?=\n|$)/gi,
      "\n",
    )
    .replace(
      /(?:^|\n)<plugins_instructions>[\s\S]*?<\/plugins_instructions>\s*(?=\n|$)/gi,
      "\n",
    )
    .replace(
      /(?:^|\n)<permissions[\s\S]*?<\/permissions instructions>\s*(?=\n|$)/gi,
      "\n",
    )
    .replace(FILES_MENTIONED_WRAPPER_PATTERN, "")
    .replace(INTERNAL_IMAGE_MARKER_OPEN_PATTERN, "")
    .replace(INTERNAL_IMAGE_MARKER_CLOSE_PATTERN, "")
    .replace(INTERRUPTED_TURN_BLOCK_PATTERN, "\n");
  return stripped
    .split("\n")
    .filter((line) => !INTERNAL_USER_MESSAGE_LINE_PATTERN.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textFromResponseContentForRole(content: unknown, role: "user" | "assistant") {
  if (typeof content === "string") {
    return role === "user" ? stripInternalUserMessageText(content) : content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const entry of content) {
    let text = "";
    if (typeof entry === "string") {
      text = entry;
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      text = firstNonEmptyString(record.text, record.output_text, record.input_text);
    }
    const normalizedText = role === "user" ? stripInternalUserMessageText(text) : text;
    if (normalizedText) {
      parts.push(normalizedText);
    }
  }
  return parts.join("\n");
}

export function sanitizeConversationItems(items: ConversationItem[]) {
  let changed = false;
  const sanitized: ConversationItem[] = [];
  for (const item of items) {
    if (item.kind !== "message" || item.role !== "user") {
      sanitized.push(item);
      continue;
    }
    const text = stripInternalUserMessageText(item.text);
    if (!text && (!item.images || item.images.length === 0)) {
      changed = true;
      continue;
    }
    if (text === item.text) {
      sanitized.push(item);
      continue;
    }
    changed = true;
    sanitized.push({ ...item, text });
  }
  return changed ? sanitized : items;
}

function buildResponseMessageItem(item: Record<string, unknown>): ConversationItem | null {
  const role = asString(item.role);
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  const text = textFromResponseContentForRole(item.content, role);
  const images = imagesFromResponseContent(item.content);
  const id = firstNonEmptyString(
    item.id,
    item.timestamp ? `response-message-${role}-${asString(item.timestamp)}` : "",
    `${role}-${text.slice(0, 32)}`,
  );
  if (!id || (!text && images.length === 0)) {
    return null;
  }
  return {
    id,
    kind: "message",
    role,
    text,
    images: images.length > 0 ? images : undefined,
  };
}

function getThreadItemPayload(item: Record<string, unknown>) {
  const itemType = asString(item.type);
  if (itemType !== "response_item" && itemType !== "event_msg") {
    return item;
  }
  const payload = item.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return item;
  }
  return {
    timestamp: item.timestamp,
    ...(payload as Record<string, unknown>),
  };
}

function normalizeDiffPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/^(?:a|b)\//, "");
}

function normalizeHistoryMessageText(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}

function historyMessageKey(item: ConversationItem) {
  if (item.kind !== "message") {
    return null;
  }
  const text = normalizeHistoryMessageText(item.text);
  return text ? `${item.role}:${text}` : null;
}

function historyMessageSource(
  rawItem: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const rawType = asString(payload.type);
  if (
    rawItem.type === "response_item" &&
    rawType === "message"
  ) {
    return "response";
  }
  if (rawType === "userMessage" || rawType === "agentMessage") {
    return "app";
  }
  return null;
}

function shouldPreferHistoryMessageSource(
  existingSource: string | null,
  incomingSource: string | null,
) {
  return existingSource === "response" && incomingSource === "app";
}

function splitUnifiedDiffByFile(diffOutput: string) {
  const trimmed = diffOutput.trim();
  if (!trimmed) {
    return [];
  }
  const changes: { path: string; kind: undefined; diff: string }[] = [];
  let chunkStart = 0;
  let lineStart = 0;
  let currentPath = "";

  const flush = (endIndex: number) => {
    const diff = trimmed.slice(chunkStart, endIndex).trim();
    if (currentPath && diff) {
      changes.push({ path: currentPath, kind: undefined, diff });
    }
  };

  for (let index = 0; index <= trimmed.length; index += 1) {
    if (index < trimmed.length && trimmed.charCodeAt(index) !== 10) {
      continue;
    }
    const line = trimmed.slice(lineStart, index);
    if (line.startsWith("diff --git ") && lineStart > chunkStart) {
      flush(lineStart - 1);
      chunkStart = lineStart;
      currentPath = "";
    }
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("diff --git ")) {
      const gitMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(trimmedLine);
      if (gitMatch?.[2]) {
        currentPath = normalizeDiffPath(gitMatch[2]);
      }
    } else if (!currentPath && trimmedLine.startsWith("+++ ")) {
      const fileMatch = /^\+\+\+ (.+)$/.exec(trimmedLine);
      if (fileMatch?.[1] && fileMatch[1] !== "/dev/null") {
        currentPath = normalizeDiffPath(fileMatch[1]);
      }
    }
    lineStart = index + 1;
  }
  flush(trimmed.length);
  return changes;
}

function parseApplyPatchChanges(patch: string) {
  const lines = patch.split(/\r?\n/);
  const changes: { path: string; kind?: string; diff?: string }[] = [];
  let current:
    | {
        path: string;
        kind?: string;
        body: string[];
      }
    | null = null;

  const flush = () => {
    if (!current?.path) {
      current = null;
      return;
    }
    const body = current.body.filter((line) => /^[+\- ]/.test(line));
    const diff = [
      `diff --git a/${current.path} b/${current.path}`,
      `--- a/${current.path}`,
      `+++ b/${current.path}`,
      "@@",
      ...body,
    ].join("\n");
    changes.push({
      path: current.path,
      kind: current.kind,
      diff,
    });
    current = null;
  };

  for (const line of lines) {
    const addMatch = /^\*\*\* Add File: (.+)$/.exec(line);
    const updateMatch = /^\*\*\* Update File: (.+)$/.exec(line);
    const deleteMatch = /^\*\*\* Delete File: (.+)$/.exec(line);
    const fileMatch = addMatch ?? updateMatch ?? deleteMatch;
    if (fileMatch?.[1]) {
      flush();
      current = {
        path: normalizeDiffPath(fileMatch[1]),
        kind: addMatch ? "add" : deleteMatch ? "delete" : undefined,
        body: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("*** ")) {
      flush();
      continue;
    }
    if (line.startsWith("@@")) {
      continue;
    }
    if (/^[+\- ]/.test(line)) {
      current.body.push(line);
    }
  }
  flush();
  return changes.filter((change) => Boolean(change.diff?.trim()));
}

function extractImageInputValue(input: Record<string, unknown>) {
  const value =
    asString(input.url ?? "") ||
    asString(input.path ?? "") ||
    asString(input.value ?? "") ||
    asString(input.data ?? "") ||
    asString(input.source ?? "");
  return value.trim();
}

function parseUserInputs(inputs: Array<Record<string, unknown>>) {
  const textParts: string[] = [];
  const markerPaths: string[] = [];
  const imageValues: string[] = [];
  inputs.forEach((input) => {
    const type = asString(input.type).toLowerCase();
    if (type === "text" || type === "input_text") {
      const text = firstNonEmptyString(input.text, input.input_text);
      markerPaths.push(...imagePathsFromInternalMarkers(text));
      const visibleText = stripInternalUserMessageText(text);
      if (visibleText) {
        textParts.push(visibleText);
      }
      return;
    }
    if (type === "skill") {
      const name = asString(input.name);
      if (name) {
        textParts.push(`$${name}`);
      }
      return;
    }
    if (type === "image" || type === "localImage") {
      const value = extractImageInputValue(input);
      if (value) {
        imageValues.push(value);
      }
    }
  });
  // <image> markers and image/localImage entries describe the same pictures;
  // drop the input_image-style entries that are already covered by a marker.
  const pairedImageCount = Math.min(markerPaths.length, imageValues.length);
  const standaloneImages = imageValues.slice(pairedImageCount);
  return {
    text: textParts.join(" ").trim(),
    images: mergeMessageImages([...markerPaths, ...standaloneImages]),
  };
}

export function buildConversationItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  item = getThreadItemPayload(item);
  const type = asString(item.type);
  if (!type) {
    return null;
  }
  if (type === "function_call") {
    return buildFunctionCallItem(item);
  }
  if (type === "custom_tool_call") {
    return buildFunctionCallItem(item);
  }
  if (type === "function_call_output") {
    return buildFunctionCallOutputItem(item);
  }
  if (type === "custom_tool_call_output") {
    return buildFunctionCallOutputItem(item);
  }
  if (type === "message") {
    return buildResponseMessageItem(item);
  }
  const id = asString(item.id);
  if (!id) {
    return null;
  }
  if (type === "agentMessage") {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text,
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "reasoning") {
    const summary = asString(item.summary ?? "");
    const content = Array.isArray(item.content)
      ? item.content.map((entry) => asString(entry)).join("\n")
      : asString(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  if (type === "agentMessage") {
    return buildAgentMessageItem(item, id);
  }
  if (type === "plan") {
    return {
      id,
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: asString(item.status ?? ""),
      status: asString(item.status ?? ""),
      output: asString(item.text ?? ""),
    };
  }
  if (type === "commandExecution") {
    const command = Array.isArray(item.command)
      ? item.command.map((part) => asString(part)).join(" ")
      : asString(item.command ?? "");
    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
    return {
      id,
      kind: "tool",
      toolType: type,
      title: command ? `Command: ${command}` : "Command",
      detail: asString(item.cwd ?? ""),
      status: asString(item.status ?? ""),
      output: extractToolOutput(item),
      durationMs,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const normalizedChanges = changes
      .map((change) => {
        const path = asString(change?.path ?? "");
        const kind = change?.kind as Record<string, unknown> | string | undefined;
        const kindType =
          typeof kind === "string"
            ? kind
            : typeof kind === "object" && kind
              ? asString((kind as Record<string, unknown>).type ?? "")
              : "";
        const normalizedKind = kindType ? kindType.toLowerCase() : "";
        const diff = asString(change?.diff ?? "");
        return { path, kind: normalizedKind || undefined, diff: diff || undefined };
      })
      .filter((change) => change.path);
    const formattedChanges = normalizedChanges
      .map((change) => {
        const prefix =
          change.kind === "add"
            ? "A"
            : change.kind === "delete"
              ? "D"
              : change.kind
                ? "M"
                : "";
        return [prefix, change.path].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const paths = formattedChanges.join(", ");
    const changesDiffOutput = normalizedChanges
      .map((change) => change.diff ?? "")
      .filter(Boolean)
      .join("\n\n");
    const diffOutput =
      changesDiffOutput ||
      firstNonEmptyString(
        item.output,
        item.aggregatedOutput,
        item.aggregated_output,
        item.diff,
        item.patch,
      );
    const displayChanges =
      normalizedChanges.length > 0 ? normalizedChanges : splitUnifiedDiffByFile(diffOutput);
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "File changes",
      detail: paths || "Pending changes",
      status: asString(item.status ?? ""),
      output: diffOutput,
      changes: displayChanges,
    };
  }
  if (type === "mcpToolCall") {
    const server = asString(item.server ?? "");
    const tool = asString(item.tool ?? "");
    const args = item.arguments ? JSON.stringify(item.arguments, null, 2) : "";
    return {
      id,
      kind: "tool",
      toolType: type,
      title: `Tool: ${server}${tool ? ` / ${tool}` : ""}`,
      detail: args,
      status: asString(item.status ?? ""),
      output: asString(item.result ?? item.error ?? ""),
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    return parseCollabToolCallItem(item);
  }
  if (type === "webSearch") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Web search",
      detail: asString(item.query ?? ""),
      status: status || "completed",
      output: "",
    };
  }
  if (type === "imageView") {
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Image view",
      detail: asString(item.path ?? ""),
      status: "",
      output: "",
    };
  }
  if (type === "contextCompaction") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Context compaction",
      detail: "Compacting conversation context to fit token limits.",
      status: status || "completed",
      output: "",
    };
  }
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    return {
      id,
      kind: "review",
      state: type === "enteredReviewMode" ? "started" : "completed",
      text: asString(item.review ?? ""),
    };
  }
  return null;
}

export function buildConversationItemFromThreadItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  item = getThreadItemPayload(item);
  const type = asString(item.type);
  if (!type) {
    return null;
  }
  if (type === "function_call") {
    return buildFunctionCallItem(item);
  }
  if (type === "custom_tool_call") {
    return buildFunctionCallItem(item);
  }
  if (type === "function_call_output") {
    return buildFunctionCallOutputItem(item);
  }
  if (type === "custom_tool_call_output") {
    return buildFunctionCallOutputItem(item);
  }
  if (type === "message") {
    return buildResponseMessageItem(item);
  }
  const id = asString(item.id);
  if (!id) {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text,
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "agentMessage") {
    return buildAgentMessageItem(item, id);
  }
  if (type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.map((entry) => asString(entry)).join("\n")
      : asString(item.summary ?? "");
    const content = Array.isArray(item.content)
      ? item.content.map((entry) => asString(entry)).join("\n")
      : asString(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  return buildConversationItem(item);
}

function mergeToolOutput(
  callItem: ConversationItem,
  outputItem: Extract<ConversationItem, { kind: "tool" }>,
): ConversationItem {
  if (callItem.kind !== "tool") {
    return callItem;
  }
  return {
    ...callItem,
    status: "completed",
    output:
      callItem.suppressToolOutput
        ? callItem.output
        :
      callItem.toolType === "fileChange" && callItem.changes?.length
        ? callItem.output
        : outputItem.output ?? callItem.output ?? "",
  };
}

export function buildItemsFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: ConversationItem[] = [];
  const seenReasoningKeys = new Set<string>();
  const functionCallIndexById = new Map<string, number>();
  const historyMessageIndexByKey = new Map<
    string,
    { index: number; source: string | null }
  >();
  const pendingFunctionOutputById = new Map<
    string,
    Extract<ConversationItem, { kind: "tool" }>
  >();
  const ignoredFunctionCallIds = new Set<string>();
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const payload = getThreadItemPayload(item);
      const rawType = asString(payload.type);
      const callId = getFunctionCallId(payload);
      if (
        (rawType === "function_call" || rawType === "custom_tool_call") &&
        isEmptyWriteStdinCall(payload)
      ) {
        if (callId) {
          ignoredFunctionCallIds.add(callId);
        }
        return;
      }
      if (
        (rawType === "function_call_output" || rawType === "custom_tool_call_output") &&
        callId &&
        ignoredFunctionCallIds.has(callId)
      ) {
        return;
      }
      const converted = buildConversationItemFromThreadItem(payload);
      if (!converted) {
        return;
      }
      if (converted.kind === "reasoning") {
        const reasoningText = converted.summary || converted.content || "";
        const normalizedText = reasoningText.replace(/\s+/g, " ").trim();
        const timestamp = asString(item.timestamp) || "";
        const reasoningKey = timestamp + ":" + normalizedText;
        
        if (seenReasoningKeys.has(reasoningKey)) {
          return;
        }
        seenReasoningKeys.add(reasoningKey);
      }
      const messageKey = historyMessageKey(converted);
      const messageSource = messageKey ? historyMessageSource(item, payload) : null;
      if (messageKey && messageSource) {
        const existing = historyMessageIndexByKey.get(messageKey);
        if (existing && existing.source !== messageSource) {
          if (shouldPreferHistoryMessageSource(existing.source, messageSource)) {
            items[existing.index] = converted;
            historyMessageIndexByKey.set(messageKey, {
              index: existing.index,
              source: messageSource,
            });
          }
          return;
        }
      }
      if (
        converted.kind === "tool"
      ) {
        const existingIndex = functionCallIndexById.get(converted.id);
        if (rawType === "function_call_output" || rawType === "custom_tool_call_output") {
          if (existingIndex !== undefined) {
            items[existingIndex] = mergeToolOutput(
              items[existingIndex],
              converted,
            );
          } else {
            pendingFunctionOutputById.set(converted.id, converted);
          }
          return;
        }
        const pendingOutput = pendingFunctionOutputById.get(converted.id);
        const nextItem = pendingOutput
          ? mergeToolOutput(converted, pendingOutput)
          : converted;
        if (existingIndex !== undefined) {
          items[existingIndex] = nextItem;
        } else {
          functionCallIndexById.set(converted.id, items.length);
          items.push(nextItem);
        }
        pendingFunctionOutputById.delete(converted.id);
        return;
      }
      if (messageKey && messageSource) {
        historyMessageIndexByKey.set(messageKey, {
          index: items.length,
          source: messageSource,
        });
      }
      items.push(converted);
    });
  });
  pendingFunctionOutputById.forEach((item) => {
    items.push(item);
  });
  return items;
}

export function isReviewingFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let reviewing = false;
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const type = asString(item?.type ?? "");
      if (type === "enteredReviewMode") {
        reviewing = true;
      } else if (type === "exitedReviewMode") {
        reviewing = false;
      }
    });
  });
  return reviewing;
}
