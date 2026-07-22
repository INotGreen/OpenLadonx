import { describe, expect, it } from "vitest";
import type { ConversationItem } from "@/types";
import { buildToolGroups } from "./messageRenderUtils";

const claudeThinking: ConversationItem = {
  id: "thinking-1",
  kind: "reasoning",
  summary: "Claude thinking",
  content: "Inspecting the implementation.",
  provider: "claude_code",
};

describe("buildToolGroups", () => {
  it("groups a standalone Claude thinking item as one tool call", () => {
    expect(buildToolGroups([claudeThinking])).toEqual([
      {
        kind: "toolGroup",
        group: {
          id: "thinking-1",
          items: [claudeThinking],
          toolCount: 1,
          messageCount: 0,
        },
      },
    ]);
  });

  it("counts Claude thinking with adjacent tools without adding a message", () => {
    const tool: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "claudeCodeToolCall",
      title: "Tool: Claude Code/Read",
      detail: "{}",
    };
    const [entry] = buildToolGroups([claudeThinking, tool]);

    expect(entry?.kind).toBe("toolGroup");
    if (entry?.kind === "toolGroup") {
      expect(entry.group.toolCount).toBe(2);
      expect(entry.group.messageCount).toBe(0);
    }
  });
});
