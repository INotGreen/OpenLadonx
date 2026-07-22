import type { ConversationItem } from "@/types";
import { normalizeItem, prepareThreadItems, upsertItem } from "@utils/threadItems";
import type { ThreadAction, ThreadState } from "../useThreadsReducer";
import {
  addSummaryBoundary,
  dropLatestLocalReviewStart,
  ensureUniqueReviewId,
  findMatchingReview,
  isDuplicateReviewById,
  mergeStreamingText,
} from "./common";

function normalizeUserMessageText(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}

function findTrailingDuplicateUserMessageIndex(
  list: ConversationItem[],
  item: Extract<ConversationItem, { kind: "message" }>,
) {
  const targetText = normalizeUserMessageText(item.text);
  if (!targetText) {
    return -1;
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    if (entry.kind === "message" && entry.role === "assistant") {
      break;
    }
    if (
      entry.kind === "message" &&
      entry.role === "user" &&
      normalizeUserMessageText(entry.text) === targetText
    ) {
      return index;
    }
  }
  return -1;
}

function findCurrentTurnAssistantIndex(list: ConversationItem[], itemId: string) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (item.kind === "message" && item.role === "user") {
      break;
    }
    if (
      item.kind === "message" &&
      item.role === "assistant" &&
      (item.id === itemId || item.id.startsWith(`${itemId}#turn-`))
    ) {
      return index;
    }
  }
  return -1;
}

function buildNewAssistantId(list: ConversationItem[], itemId: string) {
  if (!list.some((item) => item.id === itemId)) {
    return itemId;
  }
  let suffix = 1;
  let candidate = `${itemId}#turn-${suffix}`;
  const existingIds = new Set(list.map((item) => item.id));
  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${itemId}#turn-${suffix}`;
  }
  return candidate;
}

export function reduceThreadItems(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "addAssistantMessage": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const message: ConversationItem = {
        id: `${Date.now()}-assistant`,
        kind: "message",
        role: "assistant",
        text: action.text,
      };
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems([...list, message], { maxItemsPerThread: state.maxItemsPerThread }),
        },
      };
    }
    case "appendAgentDelta": {
      const list = [...(state.itemsByThread[action.threadId] ?? [])];
      const index = findCurrentTurnAssistantIndex(list, action.itemId);
      if (index >= 0 && list[index].kind === "message") {
        const existing = list[index];
        list[index] = {
          ...existing,
          text: mergeStreamingText(existing.text, action.delta),
          provider: existing.provider ?? action.provider,
        };
      } else {
        list.push({
          id: buildNewAssistantId(list, action.itemId),
          kind: "message",
          role: "assistant",
          text: action.delta,
          provider: action.provider,
        });
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(list, {
            maxItemsPerThread: state.maxItemsPerThread,
          }),
        },
      };
    }
    case "completeAgentMessage": {
      const list = [...(state.itemsByThread[action.threadId] ?? [])];
      const index = findCurrentTurnAssistantIndex(list, action.itemId);
      if (index >= 0 && list[index].kind === "message") {
        const existing = list[index];
        list[index] = {
          ...existing,
          text: action.text || existing.text,
          provider: existing.provider ?? action.provider,
        };
      } else {
        list.push({
          id: buildNewAssistantId(list, action.itemId),
          kind: "message",
          role: "assistant",
          text: action.text,
          provider: action.provider,
        });
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(list, {
            maxItemsPerThread: state.maxItemsPerThread,
          }),
        },
      };
    }
    case "upsertItem": {
      let list = state.itemsByThread[action.threadId] ?? [];
      const item = normalizeItem(action.item);
      const isUserMessage = item.kind === "message" && item.role === "user";
      if (
        item.kind === "review" &&
        item.state === "started" &&
        !item.id.startsWith("review-start-")
      ) {
        list = dropLatestLocalReviewStart(list);
      }
      if (item.kind === "review" && isDuplicateReviewById(list, item)) {
        return state;
      }
      if (item.kind === "review") {
        const existing = findMatchingReview(list, item);
        if (existing && existing.id !== item.id) {
          return state;
        }
      }
      const duplicateUserIndex = isUserMessage
        ? findTrailingDuplicateUserMessageIndex(list, item)
        : -1;
      const itemForUpsert =
        duplicateUserIndex >= 0
          ? ({ ...item, id: list[duplicateUserIndex].id } as ConversationItem)
          : item;
      const nextItem = ensureUniqueReviewId(list, itemForUpsert);
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(upsertItem(list, nextItem), {
            maxItemsPerThread: state.maxItemsPerThread,
          }),
        },
      };
    }
    case "setThreadItems":
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(action.items, { maxItemsPerThread: state.maxItemsPerThread }),
        },
      };
    case "appendReasoningSummary": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = list.findIndex((entry) => entry.id === action.itemId);
      const base =
        index >= 0 && list[index].kind === "reasoning"
          ? (list[index] as ConversationItem)
          : {
              id: action.itemId,
              kind: "reasoning",
              summary: "",
              content: "",
            };
      const updated: ConversationItem = {
        ...base,
        summary: mergeStreamingText(
          "summary" in base ? base.summary : "",
          action.delta,
        ),
      } as ConversationItem;
      const next = index >= 0 ? [...list] : [...list, updated];
      if (index >= 0) {
        next[index] = updated;
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next, { maxItemsPerThread: state.maxItemsPerThread }),
        },
      };
    }
    case "appendReasoningSummaryBoundary": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = list.findIndex((entry) => entry.id === action.itemId);
      const base =
        index >= 0 && list[index].kind === "reasoning"
          ? (list[index] as ConversationItem)
          : {
              id: action.itemId,
              kind: "reasoning",
              summary: "",
              content: "",
            };
      const updated: ConversationItem = {
        ...base,
        summary: addSummaryBoundary("summary" in base ? base.summary : ""),
      } as ConversationItem;
      const next = index >= 0 ? [...list] : [...list, updated];
      if (index >= 0) {
        next[index] = updated;
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next, { maxItemsPerThread: state.maxItemsPerThread }),
        },
      };
    }
    case "appendReasoningContent": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = list.findIndex((entry) => entry.id === action.itemId);
      const base =
        index >= 0 && list[index].kind === "reasoning"
          ? (list[index] as ConversationItem)
          : {
              id: action.itemId,
              kind: "reasoning",
              summary: "",
              content: "",
            };
      const updated: ConversationItem = {
        ...base,
        content: mergeStreamingText(
          "content" in base ? base.content : "",
          action.delta,
        ),
      } as ConversationItem;
      const next = index >= 0 ? [...list] : [...list, updated];
      if (index >= 0) {
        next[index] = updated;
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next, { maxItemsPerThread: state.maxItemsPerThread }),
        },
      };
    }
    case "appendPlanDelta": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = list.findIndex((entry) => entry.id === action.itemId);
      const base =
        index >= 0 && list[index].kind === "tool"
          ? list[index]
          : {
              id: action.itemId,
              kind: "tool",
              toolType: "plan",
              title: "Plan",
              detail: "",
              status: "in_progress",
              output: "",
            };
      const existingOutput = base.kind === "tool" ? (base.output ?? "") : "";
      const updated: ConversationItem = {
        ...(base as ConversationItem),
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "Generating plan...",
        status: "in_progress",
        output: mergeStreamingText(existingOutput, action.delta),
      } as ConversationItem;
      const next = index >= 0 ? [...list] : [...list, updated];
      if (index >= 0) {
        next[index] = updated;
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next, { maxItemsPerThread: state.maxItemsPerThread }),
        },
      };
    }
    case "appendToolOutput": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = list.findIndex((entry) => entry.id === action.itemId);
      if (index < 0 || list[index].kind !== "tool") {
        return state;
      }
      const existing = list[index];
      const updated: ConversationItem = {
        ...existing,
        output: mergeStreamingText(existing.output ?? "", action.delta),
      } as ConversationItem;
      const next = [...list];
      next[index] = updated;
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next, { maxItemsPerThread: state.maxItemsPerThread }),
        },
      };
    }
    default:
      return state;
  }
}
