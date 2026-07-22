import type { ClaudeCodeStoredChatMessage } from "@services/tauri";
import type { ConversationItem, TurnPlanStepStatus } from "@/types";
import {
  asRecord,
  buildClaudeCodeTextUserInputItem,
  buildClaudeCodeUserInputItem,
  buildClaudeCodeFileChanges,
  classifyClaudeCodeTool,
  claudeCodeToolOutput,
  isClaudeCodeUserQuestionTool,
  type JsonRecord,
  stringValue,
  toolResultText,
} from "./claudeCodeTools";

function contentBlocks(event: unknown) {
  const row = asRecord(event);
  const message = asRecord(row?.message);
  return Array.isArray(message?.content) ? message.content : [];
}

function normalizeTaskStatus(value: unknown): TurnPlanStepStatus {
  if (value === "completed") return "completed";
  if (value === "in_progress" || value === "inProgress") return "inProgress";
  return "pending";
}

export function buildClaudeCodeConversation(messages: ClaudeCodeStoredChatMessage[]) {
  const items: ConversationItem[] = [];
  const toolsById = new Map<string, Extract<ConversationItem, { kind: "tool" }>>();
  const userInputsById = new Map<string, Extract<ConversationItem, { kind: "userInput" }>>();
  // Remember each tool call's name + parsed input so we can synthesize a
  // readable output when the matching tool_result arrives later.
  const toolMetaById = new Map<string, { name: string; input: JsonRecord }>();
  const tasks = new Map<string, { subject: string; status: TurnPlanStepStatus }>();

  for (const message of messages) {
    const events = message.events?.length ? message.events : [message.rawJson];
    let emittedStructuredContent = false;

    for (const event of events) {
      for (const unknownBlock of contentBlocks(event)) {
        const block = asRecord(unknownBlock);
        if (!block) continue;
        const type = stringValue(block.type);
        if (type === "thinking") {
          // Thinking is not rendered per user preference; just mark that we
          // saw structured content so a thinking-only message doesn't fall
          // through to the plain-text fallback below.
          emittedStructuredContent = true;
        } else if (type === "text") {
          const text = stringValue(block.text).trim();
          if (text) {
            const id = `${message.id}-text-${items.length}`;
            const userInput =
              message.role === "assistant"
                ? buildClaudeCodeTextUserInputItem({ id, text })
                : null;
            items.push(
              userInput ?? {
                id,
                kind: "message",
                role: message.role === "user" ? "user" : "assistant",
                text,
                ...(message.role === "assistant" ? { provider: "claude_code" as const } : {}),
              },
            );
          }
          emittedStructuredContent = true;
        } else if (type === "tool_use") {
          const id = stringValue(block.id) || `${message.id}-tool-${items.length}`;
          const name = stringValue(block.name) || "Tool";
          const input = asRecord(block.input) ?? {};
          const normalizedName = name.toLowerCase();
          if (isClaudeCodeUserQuestionTool(name)) {
            const item = buildClaudeCodeUserInputItem({
              id: `${message.id}-user-input-${id}`,
              input,
            });
            items.push(item);
            userInputsById.set(id, item);
            toolMetaById.set(id, { name, input });
            emittedStructuredContent = true;
            continue;
          }
          if (normalizedName === "taskcreate") {
            const taskId = stringValue(input.taskId) || String(tasks.size + 1);
            tasks.set(taskId, {
              subject: stringValue(input.subject) || stringValue(input.description) || `Task ${taskId}`,
              status: normalizeTaskStatus(input.status),
            });
          } else if (normalizedName === "taskupdate") {
            const taskId = stringValue(input.taskId);
            const current = tasks.get(taskId);
            if (taskId && current) {
              tasks.set(taskId, {
                subject: stringValue(input.subject) || current.subject,
                status: normalizeTaskStatus(input.status),
              });
            }
          }
          const tool: Extract<ConversationItem, { kind: "tool" }> = {
            id,
            kind: "tool",
            status: "completed",
            ...classifyClaudeCodeTool(name, input),
          };
          const changes = buildClaudeCodeFileChanges(name, input);
          if (changes && changes.length > 0) {
            tool.changes = changes;
          }
          if (normalizedName === "taskcreate" || normalizedName === "taskupdate") {
            tool.toolType = "plan";
            tool.plan = {
              explanation: "Claude Code tasks",
              steps: Array.from(tasks.values(), (task) => ({
                step: task.subject,
                status: task.status,
              })),
            };
          }
          items.push(tool);
          toolsById.set(id, tool);
          toolMetaById.set(id, { name, input });
          emittedStructuredContent = true;
        } else if (type === "tool_result") {
          const toolId = stringValue(block.tool_use_id);
          const userInput = userInputsById.get(toolId);
          if (userInput) {
            const meta = toolMetaById.get(toolId);
            const updated = buildClaudeCodeUserInputItem({
              id: userInput.id,
              input: meta?.input ?? {},
              resultText: toolResultText(block),
            });
            Object.assign(userInput, updated);
            emittedStructuredContent = true;
            continue;
          }
          const tool = toolsById.get(toolId);
          const resultText = toolResultText(block);
          if (tool) {
            const meta = toolMetaById.get(toolId);
            tool.output = meta
              ? claudeCodeToolOutput(meta.name, meta.input, resultText)
              : resultText;
            tool.status = block.is_error === true ? "failed" : "completed";
          }
          emittedStructuredContent = true;
        }
      }
    }

    const text = message.text.trim();
    if (!emittedStructuredContent && text && (message.role === "user" || message.role === "assistant")) {
      const id = message.id || `claude-message-${items.length}`;
      const userInput =
        message.role === "assistant"
          ? buildClaudeCodeTextUserInputItem({ id, text })
          : null;
      items.push(
        userInput ?? {
          id,
          kind: "message",
          role: message.role,
          text,
          ...(message.role === "assistant" ? { provider: "claude_code" as const } : {}),
        },
      );
    }
  }
  return items;
}
