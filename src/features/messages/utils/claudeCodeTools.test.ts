import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeFileChanges,
  buildClaudeCodeToolItem,
  classifyClaudeCodeTool,
  claudeCodeToolOutput,
  parseJsonObject,
  toolResultText,
} from "./claudeCodeTools";

describe("classifyClaudeCodeTool", () => {
  it("maps Bash to a commandExecution with command + cwd", () => {
    expect(
      classifyClaudeCodeTool("Bash", { command: "ls -la", cwd: "/tmp" }),
    ).toEqual({
      toolType: "commandExecution",
      title: "Command: ls -la",
      detail: "/tmp",
    });
  });

  it("maps Read to claudeCodeToolCall and Write/Edit/MultiEdit to fileChange", () => {
    expect(classifyClaudeCodeTool("Read", { file_path: "/a/b.rs" })).toEqual({
      toolType: "claudeCodeToolCall",
      title: "Tool: Claude Code/Read",
      detail: "/a/b.rs",
    });
    expect(classifyClaudeCodeTool("Write", { file_path: "/c.ts" })).toEqual({
      toolType: "fileChange",
      title: "Tool: Claude Code/Write",
      detail: "/c.ts",
    });
    expect(classifyClaudeCodeTool("Edit", { file_path: "/d.go" })).toEqual({
      toolType: "fileChange",
      title: "Tool: Claude Code/Edit",
      detail: "/d.go",
    });
    expect(classifyClaudeCodeTool("MultiEdit", { file_path: "/e.py" })).toEqual({
      toolType: "fileChange",
      title: "Tool: Claude Code/MultiEdit",
      detail: "/e.py",
    });
  });

  it("maps Grep/Glob to claudeCodeToolCall with the pattern", () => {
    expect(classifyClaudeCodeTool("Grep", { pattern: "TODO", path: "/src" })).toEqual({
      toolType: "claudeCodeToolCall",
      title: "Tool: Claude Code/Grep",
      detail: "TODO",
    });
    expect(classifyClaudeCodeTool("Glob", { pattern: "**/*.rs" })).toEqual({
      toolType: "claudeCodeToolCall",
      title: "Tool: Claude Code/Glob",
      detail: "**/*.rs",
    });
  });

  it("maps WebSearch/WebFetch to webSearch", () => {
    expect(classifyClaudeCodeTool("WebSearch", { query: "rust async" }).toolType).toBe(
      "webSearch",
    );
  });

  it("falls back to claudeCodeToolCall with a subject/detail for unknown tools", () => {
    expect(classifyClaudeCodeTool("TaskCreate", { subject: "ship it" })).toEqual({
      toolType: "claudeCodeToolCall",
      title: "Tool: Claude Code/TaskCreate",
      detail: "ship it",
    });
    expect(classifyClaudeCodeTool("Mystery", { foo: "bar" }).detail).toBe(
      JSON.stringify({ foo: "bar" }, null, 2),
    );
  });
});

describe("claudeCodeToolOutput", () => {
  it("surfaces the written content for Write", () => {
    expect(
      claudeCodeToolOutput("Write", { file_path: "/x", content: "hello\n" }, "ok"),
    ).toBe("hello\n");
  });

  it("surfaces new_string for Edit", () => {
    expect(
      claudeCodeToolOutput("Edit", { new_string: "patched" }, "updated"),
    ).toBe("patched");
  });

  it("joins new_string from each edit for MultiEdit", () => {
    expect(
      claudeCodeToolOutput(
        "MultiEdit",
        { edits: [{ new_string: "a" }, { new_string: "b" }] },
        "done",
      ),
    ).toBe("a\n\n---\n\nb");
  });

  it("falls back to the result text for Read/Grep/Bash", () => {
    expect(claudeCodeToolOutput("Read", { file_path: "/x" }, "file body")).toBe(
      "file body",
    );
    expect(claudeCodeToolOutput("Bash", { command: "ls" }, "a\nb")).toBe("a\nb");
  });
});

describe("buildClaudeCodeToolItem", () => {
  it("builds an in-progress Read tool item", () => {
    const item = buildClaudeCodeToolItem({
      id: "t1",
      name: "Read",
      input: { file_path: "/a.rs" },
      status: "inProgress",
    });
    expect(item).toEqual({
      id: "t1",
      kind: "tool",
      toolType: "claudeCodeToolCall",
      title: "Tool: Claude Code/Read",
      detail: "/a.rs",
      status: "inProgress",
    });
  });

  it("attaches output when provided", () => {
    const item = buildClaudeCodeToolItem({
      id: "t2",
      name: "Bash",
      input: { command: "echo hi" },
      status: "completed",
      output: "hi",
    });
    expect(item.toolType).toBe("commandExecution");
    expect(item.output).toBe("hi");
  });

  it("attaches an inline diff for Write and Edit", () => {
    const writeItem = buildClaudeCodeToolItem({
      id: "w1",
      name: "Write",
      input: { file_path: "/x.ts", content: "a\nb\n" },
      status: "completed",
    });
    expect(writeItem.toolType).toBe("fileChange");
    expect(writeItem.changes?.[0]?.path).toBe("/x.ts");
    expect(writeItem.changes?.[0]?.diff).toContain("+++ b//x.ts");
    expect(writeItem.changes?.[0]?.diff).toContain("+a");
    expect(writeItem.changes?.[0]?.diff).toContain("+b");

    const editItem = buildClaudeCodeToolItem({
      id: "e1",
      name: "Edit",
      input: {
        file_path: "/y.rs",
        old_string: "let x = 1;\n",
        new_string: "let x = 2;\n",
      },
      status: "completed",
    });
    expect(editItem.toolType).toBe("fileChange");
    const diff = editItem.changes?.[0]?.diff ?? "";
    expect(diff).toContain("-let x = 1;");
    expect(diff).toContain("+let x = 2;");
  });

  it("skips the diff when includeChanges is false", () => {
    const item = buildClaudeCodeToolItem({
      id: "w2",
      name: "Write",
      input: { file_path: "/x.ts", content: "a\n" },
      status: "inProgress",
      includeChanges: false,
    });
    expect(item.toolType).toBe("fileChange");
    expect(item.changes).toBeUndefined();
  });
});

describe("buildClaudeCodeFileChanges", () => {
  it("renders Write as all additions", () => {
    const changes = buildClaudeCodeFileChanges("Write", {
      file_path: "/src/a.ts",
      content: "foo\nbar\n",
    });
    expect(changes).toHaveLength(1);
    expect(changes?.[0]?.kind).toBe("add");
    const diff = changes?.[0]?.diff ?? "";
    expect(diff).toContain("diff --git a//src/a.ts b//src/a.ts");
    expect(diff).toContain("+foo");
    expect(diff).toContain("+bar");
    // No removal body lines (the `--- a/` metadata header is not a removal).
    expect(diff).not.toMatch(/^-[^-]/m);
  });

  it("renders Edit as a line diff with shared context", () => {
    const changes = buildClaudeCodeFileChanges("Edit", {
      file_path: "/m.rs",
      old_string: "fn a() {\n  1\n}\n",
      new_string: "fn a() {\n  2\n}\n",
    });
    const diff = changes?.[0]?.diff ?? "";
    // Shared lines stay as context.
    expect(diff).toContain(" fn a() {");
    expect(diff).toContain(" }");
    // Only the changed line is +/-.
    expect(diff).toContain("-  1");
    expect(diff).toContain("+  2");
  });

  it("renders a pure deletion (empty new_string) as all removals", () => {
    const changes = buildClaudeCodeFileChanges("Edit", {
      file_path: "/d.rs",
      old_string: "gone\n",
      new_string: "",
    });
    const diff = changes?.[0]?.diff ?? "";
    expect(diff).toContain("-gone");
    // No addition body lines (the `+++ b/` metadata header is not an addition).
    expect(diff).not.toMatch(/^\+[^+]/m);
  });

  it("emits one hunk per edit for MultiEdit", () => {
    const changes = buildClaudeCodeFileChanges("MultiEdit", {
      file_path: "/m.py",
      edits: [
        { old_string: "a=1\n", new_string: "a=2\n" },
        { old_string: "b=3\n", new_string: "b=4\n" },
      ],
    });
    expect(changes).toHaveLength(1);
    const diff = changes?.[0]?.diff ?? "";
    expect(diff).toContain("-a=1");
    expect(diff).toContain("+a=2");
    expect(diff).toContain("-b=3");
    expect(diff).toContain("+b=4");
    // Two hunks → two @@ separators.
    expect(diff.match(/^@@$/gm)).toHaveLength(2);
  });

  it("returns null for read-only tools and missing paths", () => {
    expect(buildClaudeCodeFileChanges("Read", { file_path: "/x" })).toBeNull();
    expect(buildClaudeCodeFileChanges("Write", { content: "x" })).toBeNull();
    expect(buildClaudeCodeFileChanges("Write", { file_path: "/x", content: "" })).toBeNull();
    expect(
      buildClaudeCodeFileChanges("Edit", { file_path: "/x", old_string: "", new_string: "" }),
    ).toBeNull();
  });
});

describe("toolResultText", () => {
  it("joins text blocks", () => {
    expect(
      toolResultText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
    ).toBe("a\n\nb");
  });
  it("returns plain string content", () => {
    expect(toolResultText({ content: "raw" })).toBe("raw");
  });
});

describe("parseJsonObject", () => {
  it("parses a complete object", () => {
    expect(parseJsonObject('{"file_path":"/x"}')).toEqual({ file_path: "/x" });
  });
  it("returns null for partial json", () => {
    expect(parseJsonObject('{"file_path":"/x"')).toBeNull();
  });
  it("returns null for non-object json", () => {
    expect(parseJsonObject('["a"]')).toBeNull();
    expect(parseJsonObject("123")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(parseJsonObject("")).toBeNull();
  });
});
