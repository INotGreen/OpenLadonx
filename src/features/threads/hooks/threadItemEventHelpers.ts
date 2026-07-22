import { buildConversationItem } from "@utils/threadItems";
import type { CollabAgentRef } from "@/types";
import { asString } from "@threads/utils/threadNormalize";

export function buildItemForDisplay(
  item: Record<string, unknown>,
  shouldMarkProcessing: boolean,
) {
  const itemType = asString(item?.type ?? "");
  if (itemType !== "contextCompaction" && itemType !== "webSearch") {
    return item;
  }

  return {
    ...item,
    status: shouldMarkProcessing ? "inProgress" : "completed",
  } as Record<string, unknown>;
}

export function handleConvertedItemEffects({
  converted,
  workspaceId,
  hydrateSubagentThreads,
}: {
  converted: ReturnType<typeof buildConversationItem>;
  workspaceId: string;
  hydrateSubagentThreads?: (
    workspaceId: string,
    receivers: CollabAgentRef[],
  ) => void | Promise<void>;
}) {
  if (!converted) {
    return;
  }

  if (converted.kind === "tool" && converted.toolType === "collabToolCall") {
    const receivers = converted.collabReceivers?.length
      ? converted.collabReceivers
      : converted.collabReceiver
        ? [converted.collabReceiver]
        : [];
    const hydrationTargets = receivers.filter(
      (receiver) => receiver.threadId && (!receiver.nickname || !receiver.role),
    );
    if (hydrationTargets.length > 0) {
      void hydrateSubagentThreads?.(workspaceId, hydrationTargets);
    }
  }
}
