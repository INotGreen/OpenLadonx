import { describe, expect, it } from "vitest";
import type { ClaudeCodeStoredChatMessage } from "@services/tauri";
import type { ConversationItem } from "@/types";
import { buildClaudeCodeConversation } from "./claudeCodeConversation";

function storedMessage(
  id: string,
  role: string,
  content: unknown,
): ClaudeCodeStoredChatMessage {
  const event = { message: { content } };
  return {
    id,
    role,
    text: typeof content === "string" ? content : "",
    rawJson: event,
    events: [event],
    createdAt: 0,
  };
}

describe("buildClaudeCodeConversation", () => {
  it("drops thinking and preserves text, tool calls, results, and user messages", () => {
    const messages = [
      storedMessage("user-1", "user", "Inspect the file"),
      storedMessage("assistant-1", "assistant", [
        { type: "thinking", thinking: "I should read it first." },
        {
          type: "tool_use",
          id: "call-1",
          name: "Bash",
          input: { command: "wc -l README.md" },
        },
      ]),
      storedMessage("call-1", "tool", [
        { type: "tool_result", tool_use_id: "call-1", content: "42 README.md" },
      ]),
      storedMessage("assistant-2", "assistant", [
        { type: "text", text: "The file has 42 lines." },
      ]),
    ];

    expect(buildClaudeCodeConversation(messages)).toEqual([
      { id: "user-1", kind: "message", role: "user", text: "Inspect the file" },
      {
        id: "call-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: wc -l README.md",
        detail: "",
        status: "completed",
        output: "42 README.md",
      },
      {
        id: "assistant-2-text-2",
        kind: "message",
        role: "assistant",
        text: "The file has 42 lines.",
        provider: "claude_code",
      },
    ]);
  });

  it("converts Claude task tools into status panel plan snapshots", () => {
    const messages = [
      storedMessage("assistant-1", "assistant", [{
        type: "tool_use",
        id: "create-1",
        name: "TaskCreate",
        input: { subject: "Build release artifacts" },
      }]),
      storedMessage("assistant-2", "assistant", [{
        type: "tool_use",
        id: "create-2",
        name: "TaskCreate",
        input: { subject: "Upload artifacts" },
      }]),
      storedMessage("assistant-3", "assistant", [{
        type: "tool_use",
        id: "update-1",
        name: "TaskUpdate",
        input: { taskId: "1", status: "in_progress" },
      }]),
      storedMessage("assistant-4", "assistant", [{
        type: "tool_use",
        id: "update-2",
        name: "TaskUpdate",
        input: { taskId: "1", status: "completed" },
      }]),
    ];

    const planTools = buildClaudeCodeConversation(messages).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolType === "plan",
    );

    expect(planTools[planTools.length - 1]?.plan).toEqual({
      explanation: "Claude Code tasks",
      steps: [
        { step: "Build release artifacts", status: "completed" },
        { step: "Upload artifacts", status: "pending" },
      ],
    });
  });

  it("classifies Read/Write/Edit/Grep tool calls and binds their outputs", () => {
    const messages = [
      storedMessage("a-read", "assistant", [
        { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/src/a.rs" } },
      ]),
      storedMessage("a-read-res", "user", [
        { type: "tool_result", tool_use_id: "read-1", content: "pub fn a() {}" },
      ]),
      storedMessage("a-write", "assistant", [
        {
          type: "tool_use",
          id: "write-1",
          name: "Write",
          input: { file_path: "/src/b.rs", content: "pub fn b() {}\n" },
        },
      ]),
      storedMessage("a-write-res", "user", [
        { type: "tool_result", tool_use_id: "write-1", content: "File created successfully" },
      ]),
      storedMessage("a-edit", "assistant", [
        {
          type: "tool_use",
          id: "edit-1",
          name: "Edit",
          input: { file_path: "/src/c.rs", new_string: "edited" },
        },
      ]),
      storedMessage("a-edit-res", "user", [
        { type: "tool_result", tool_use_id: "edit-1", content: "updated", is_error: false },
      ]),
      storedMessage("a-grep", "assistant", [
        { type: "tool_use", id: "grep-1", name: "Grep", input: { pattern: "TODO" } },
      ]),
      storedMessage("a-grep-res", "user", [
        { type: "tool_result", tool_use_id: "grep-1", content: "src/a.rs:1:TODO" },
      ]),
    ];

    const tools = buildClaudeCodeConversation(messages).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> => item.kind === "tool",
    );

    expect(tools).toEqual([
      {
        id: "read-1",
        kind: "tool",
        toolType: "claudeCodeToolCall",
        title: "Tool: Claude Code/Read",
        detail: "/src/a.rs",
        status: "completed",
        output: "pub fn a() {}",
      },
      {
        id: "write-1",
        kind: "tool",
        toolType: "fileChange",
        title: "Tool: Claude Code/Write",
        detail: "/src/b.rs",
        status: "completed",
        // Write surfaces the written content, not the boilerplate result text.
        output: "pub fn b() {}\n",
        changes: [
          {
            path: "/src/b.rs",
            kind: "add",
            diff: expect.stringContaining("+pub fn b() {}"),
          },
        ],
      },
      {
        id: "edit-1",
        kind: "tool",
        toolType: "fileChange",
        title: "Tool: Claude Code/Edit",
        detail: "/src/c.rs",
        status: "completed",
        output: "edited",
        changes: [
          {
            path: "/src/c.rs",
            diff: expect.stringContaining("+edited"),
          },
        ],
      },
      {
        id: "grep-1",
        kind: "tool",
        toolType: "claudeCodeToolCall",
        title: "Tool: Claude Code/Grep",
        detail: "TODO",
        status: "completed",
        output: "src/a.rs:1:TODO",
      },
    ]);
  });

  it("marks a tool failed when its result is an error", () => {
    const messages = [
      storedMessage("a", "assistant", [
        { type: "tool_use", id: "r1", name: "Read", input: { file_path: "/missing" } },
      ]),
      storedMessage("b", "user", [
        { type: "tool_result", tool_use_id: "r1", content: "nope", is_error: true },
      ]),
    ];
    const tools = buildClaudeCodeConversation(messages).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> => item.kind === "tool",
    );
    expect(tools[0]?.status).toBe("failed");
    expect(tools[0]?.output).toBe("nope");
  });

  it("renders Claude Code user-question tools as input request items", () => {
    const messages = [
      storedMessage("ask", "assistant", [
        {
          type: "tool_use",
          id: "ask-1",
          name: "AskUserQuestion",
          input: {
            question: "Which database should I target?",
            options: [
              { label: "Postgres", description: "Use the production database" },
              { label: "SQLite", description: "Use a local file" },
            ],
          },
        },
      ]),
      storedMessage("answer", "user", [
        { type: "tool_result", tool_use_id: "ask-1", content: "Postgres" },
      ]),
    ];

    expect(buildClaudeCodeConversation(messages)).toEqual([
      {
        id: "ask-user-input-ask-1",
        kind: "userInput",
        status: "answered",
        questions: [
          {
            id: "question-1",
            header: "",
            question: "Which database should I target?",
            answers: ["Postgres"],
            options: [
              { label: "Postgres", description: "Use the production database" },
              { label: "SQLite", description: "Use a local file" },
            ],
          },
        ],
      },
    ]);
  });

  it("renders Claude Code text questions as input request items", () => {
    const messages = [
      storedMessage("ask-text", "assistant", [
        {
          type: "text",
          text: [
            "好的，请问您希望这次测试选择哪种方式？",
            "",
            "- A. 只读检查",
            "- B. 创建临时文件后删除",
            "- C. 检查项目结构",
            "",
            "请回复 A/B/C，我会在收到您的选择后再继续执行。",
          ].join("\n"),
        },
      ]),
    ];

    expect(buildClaudeCodeConversation(messages)).toEqual([
      {
        id: "ask-text-text-0",
        kind: "userInput",
        status: "requested",
        questions: [
          {
            id: "question-1",
            header: "",
            question: "好的，请问您希望这次测试选择哪种方式？",
            answers: [],
          },
        ],
      },
    ]);
  });
});
