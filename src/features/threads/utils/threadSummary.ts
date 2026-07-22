import type { ThreadSummary } from "@/types";
import {
  getThreadCreatedTimestamp,
  getThreadTimestamp,
} from "@utils/threadItems";
import { extractThreadCodexMetadata } from "@threads/utils/threadCodexMetadata";
import {
  getParentThreadIdFromThread,
  getSubagentMetadataFromThread,
  isSubagentThreadSource,
  shouldHideSubagentThreadFromSidebar,
} from "@threads/utils/threadRpc";

type BuildThreadSummaryFromThreadOptions = {
  workspaceId: string;
  thread: Record<string, unknown>;
  fallbackIndex: number;
  getCustomName?: (workspaceId: string, threadId: string) => string | undefined;
};

function getOptionalString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function extractThreadFilePath(
  thread: Record<string, unknown> | null | undefined,
): string | null {
  if (!thread) {
    return null;
  }
  return getOptionalString(thread, [
    "filePath",
    "file_path",
    "threadPath",
    "thread_path",
    "conversationPath",
    "conversation_path",
    "logPath",
    "log_path",
    "path",
  ]);
}

export function extractThreadFilePathFromResponse(
  response: Record<string, unknown> | null | undefined,
): string | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }
  const thread = extractThreadFromResponse(response);
  if (thread) {
    const threadFilePath = extractThreadFilePath(thread);
    if (threadFilePath) {
      return threadFilePath;
    }
  }
  const result =
    response.result && typeof response.result === "object" && !Array.isArray(response.result)
      ? (response.result as Record<string, unknown>)
      : null;
  return (
    extractThreadFilePath(result) ??
    getOptionalString(response, [
      "filePath",
      "file_path",
      "threadPath",
      "thread_path",
      "conversationPath",
      "conversation_path",
      "logPath",
      "log_path",
      "path",
    ])
  );
}

export function extractThreadFromResponse(
  response: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }
  const result =
    response.result && typeof response.result === "object" && !Array.isArray(response.result)
      ? (response.result as Record<string, unknown>)
      : null;
  const thread =
    (result?.thread as Record<string, unknown> | undefined) ??
    (response.thread as Record<string, unknown> | undefined);
  return thread ?? null;
}

export function buildThreadSummaryFromThread({
  workspaceId,
  thread,
  fallbackIndex,
  getCustomName,
}: BuildThreadSummaryFromThreadOptions): ThreadSummary | null {
  const id = String(thread?.id ?? "");
  if (!id) {
    return null;
  }
  const customName = getCustomName?.(workspaceId, id);
  const explicitName = getOptionalString(thread, ["name", "threadName", "title"]);
  const fallbackName = `Agent ${fallbackIndex + 1}`;
  const name = explicitName ?? customName ?? fallbackName;
  const metadata = extractThreadCodexMetadata(thread);
  const filePath = extractThreadFilePath(thread);
  if (shouldHideSubagentThreadFromSidebar(thread.source)) {
    return null;
  }
  const subagentMetadata = getSubagentMetadataFromThread(thread);
  const isSubagent =
    isSubagentThreadSource(thread.source) ||
    Boolean(getParentThreadIdFromThread(thread)) ||
    Boolean(subagentMetadata.nickname || subagentMetadata.role);
  return {
    id,
    name,
    updatedAt: getThreadTimestamp(thread),
    createdAt: getThreadCreatedTimestamp(thread),
    ...(filePath ? { filePath } : {}),
    ...(metadata.modelId ? { modelId: metadata.modelId } : {}),
    ...(metadata.effort ? { effort: metadata.effort } : {}),
    ...(isSubagent ? { isSubagent: true } : {}),
    ...(isSubagent && subagentMetadata.nickname
      ? { subagentNickname: subagentMetadata.nickname }
      : {}),
    ...(isSubagent && subagentMetadata.role
      ? { subagentRole: subagentMetadata.role }
      : {}),
  };
}
