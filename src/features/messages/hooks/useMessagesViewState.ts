import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Key,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ConversationItem } from "../../../types";
import { isPlanReadyTaggedMessage } from "../../../utils/internalPlanReadyMessages";
import {
  buildToolGroups,
  computePlanFollowupState,
  parseReasoning,
  scrollKeyForItems,
} from "../utils/messageRenderUtils";

type UseMessagesViewStateArgs = {
  items: ConversationItem[];
  threadId: string | null;
  isThinking: boolean;
  activeUserInputRequestId: string | number | null;
  hasVisibleUserInputRequest: boolean;
  onPlanAccept?: () => void;
};

export function useMessagesViewState({
  items,
  threadId,
  isThinking,
  activeUserInputRequestId,
  hasVisibleUserInputRequest,
  onPlanAccept,
}: UseMessagesViewStateArgs) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const manuallyToggledExpandedRef = useRef<Set<string>>(new Set());
  const reasoningCacheRef = useRef(
    new Map<
      string,
      {
        summary: string;
        content: string;
        parsed: ReturnType<typeof parseReasoning>;
      }
    >(),
  );

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Set<string>>(
    new Set(),
  );
  const [dismissedPlanFollowupByThread, setDismissedPlanFollowupByThread] =
    useState<Record<string, string>>({});

  const scrollKey = `${scrollKeyForItems(items)}-${activeUserInputRequestId ?? "no-input"}`;

  const updateAutoScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const currentScrollTop = node.scrollTop;
    const distanceFromBottom =
      node.scrollHeight - currentScrollTop - node.clientHeight;
    if (distanceFromBottom <= 8) {
      autoScrollRef.current = true;
    } else if (currentScrollTop < previousScrollTopRef.current - 1) {
      autoScrollRef.current = false;
    }
    previousScrollTopRef.current = currentScrollTop;
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    manuallyToggledExpandedRef.current.add(id);
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleToolGroup = useCallback((id: string, defaultCollapsed = false) => {
    setCollapsedToolGroups((prev) => {
      const next = new Set(prev);
      const key = defaultCollapsed ? `expanded:${id}` : id;
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      next.add(key);
      return next;
    });
  }, []);

  const { reasoningMetaById, latestReasoningLabel, visibleItems } = useMemo(() => {
    const nextReasoningMetaById = new Map<string, ReturnType<typeof parseReasoning>>();
    const nextVisibleItems: ConversationItem[] = [];
    const nextReasoningCache = new Map<
      string,
      {
        summary: string;
        content: string;
        parsed: ReturnType<typeof parseReasoning>;
      }
    >();

    for (const item of items) {
      if (
        item.kind === "message" &&
        item.role === "user" &&
        isPlanReadyTaggedMessage(item.text)
      ) {
        continue;
      }
      // Claude Code "thinking" is never displayed (user opted out). Filter it
      // here as the single render chokepoint so it stays hidden regardless of
      // source — live stream, history rebuild, or stale persisted state.
      // Codex reasoning has no `provider` and is unaffected.
      if (item.kind === "reasoning" && item.provider === "claude_code") {
        continue;
      }
      if (item.kind !== "reasoning") {
        nextVisibleItems.push(item);
        continue;
      }
      const cached = reasoningCacheRef.current.get(item.id);
      const parsed =
        cached && cached.summary === item.summary && cached.content === item.content
          ? cached.parsed
          : parseReasoning(item);
      nextReasoningMetaById.set(item.id, parsed);
      nextReasoningCache.set(item.id, {
        summary: item.summary,
        content: item.content,
        parsed,
      });
      if (parsed.hasBody) {
        nextVisibleItems.push(item);
      }
    }

    reasoningCacheRef.current = nextReasoningCache;

    let nextLatestReasoningLabel: string | null = null;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "message") {
        break;
      }
      if (item.kind !== "reasoning") {
        continue;
      }
      const parsed = nextReasoningMetaById.get(item.id);
      if (parsed?.workingLabel) {
        nextLatestReasoningLabel = parsed.workingLabel;
        break;
      }
    }

    return {
      reasoningMetaById: nextReasoningMetaById,
      latestReasoningLabel: nextLatestReasoningLabel,
      visibleItems: nextVisibleItems,
    };
  }, [items]);

  useEffect(() => {
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      if (
        item.kind === "tool" &&
        item.toolType === "plan" &&
        (item.output ?? "").trim().length > 0
      ) {
        if (manuallyToggledExpandedRef.current.has(item.id)) {
          return;
        }
        setExpandedItems((prev) => {
          if (prev.has(item.id)) {
            return prev;
          }
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
        return;
      }
    }
  }, [visibleItems]);

  const groupedItems = useMemo(() => buildToolGroups(visibleItems), [visibleItems]);

  const tailIndex = groupedItems.length;
  const tailIndexRef = useRef(tailIndex);
  tailIndexRef.current = tailIndex;

  // Larger overscan keeps a buffer of rows above the viewport already
  // mounted and measured, so the first scroll-up doesn't have to drift-
  // correct a wave of fresh measurements (which the user feels as a brief
  // thumb jitter when opening a thread).
  const virtualizer = useVirtualizer({
    count: tailIndex + 1,
    getScrollElement: () => containerRef.current,
    estimateSize: (index: number) => (index === tailIndex ? 120 : 150),
    overscan: 40,
    getItemKey: (index: number) => {
      if (index === tailIndex) return "__tail__";
      const entry = groupedItems[index];
      if (!entry) return `index:${index}`;
      return entry.kind === "toolGroup"
        ? `tool-group:${entry.group.id}`
        : `item:${entry.item.id}`;
    },
  });

  const requestAutoScroll = useCallback(() => {
    if (!autoScrollRef.current) {
      return;
    }
    virtualizer.scrollToIndex(tailIndexRef.current, { align: "end" });
  }, [virtualizer]);

  useLayoutEffect(() => {
    autoScrollRef.current = true;
  }, [threadId]);

  useLayoutEffect(() => {
    if (!autoScrollRef.current) {
      return;
    }
    virtualizer.scrollToIndex(tailIndexRef.current, { align: "end" });
  }, [scrollKey, isThinking, threadId, virtualizer]);

  // Manual scroll anchoring. Browser-native scroll anchoring ignores
  // absolutely-positioned descendants, so the virtualized rows here don't
  // qualify. Without this compensation, whenever a row above the viewport
  // finishes measuring (estimate -> actual) every row below — including the
  // ones the user is looking at — shifts, which resizes scrollHeight and
  // makes the scrollbar thumb jitter under the cursor. We pin the topmost
  // visible row by key; if its absolute `start` drifts between renders, we
  // push scrollTop by the same delta so the viewport stays visually stable.
  const scrollAnchorRef = useRef<{
    key: Key;
    start: number;
  } | null>(null);

  useLayoutEffect(() => {
    scrollAnchorRef.current = null;
  }, [threadId]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const virtualItems = virtualizer.getVirtualItems();
    if (virtualItems.length === 0) {
      scrollAnchorRef.current = null;
      return;
    }
    const scrollTop = container.scrollTop;
    let topItem: typeof virtualItems[number] | null = null;
    for (const vi of virtualItems) {
      if (vi.start + vi.size > scrollTop) {
        topItem = vi;
        break;
      }
    }
    if (!topItem) {
      scrollAnchorRef.current = null;
      return;
    }
    const prev = scrollAnchorRef.current;
    scrollAnchorRef.current = { key: topItem.key, start: topItem.start };
    if (!prev || prev.key !== topItem.key) {
      return;
    }
    const drift = topItem.start - prev.start;
    if (drift === 0) {
      return;
    }
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    const next = Math.max(0, Math.min(maxScrollTop, scrollTop + drift));
    if (next !== scrollTop) {
      container.scrollTop = next;
    }
  });

  const planFollowup = useMemo(() => {
    if (!onPlanAccept) {
      return { shouldShow: false, planItemId: null };
    }

    const candidate = computePlanFollowupState({
      threadId,
      items,
      isThinking,
      hasVisibleUserInputRequest,
    });

    if (threadId && candidate.planItemId) {
      if (dismissedPlanFollowupByThread[threadId] === candidate.planItemId) {
        return { ...candidate, shouldShow: false };
      }
    }

    return candidate;
  }, [
    dismissedPlanFollowupByThread,
    hasVisibleUserInputRequest,
    isThinking,
    items,
    onPlanAccept,
    threadId,
  ]);

  const dismissPlanFollowup = useCallback(() => {
    if (!threadId || !planFollowup.planItemId) {
      return;
    }
    setDismissedPlanFollowupByThread((prev) => ({
      ...prev,
      [threadId]: planFollowup.planItemId!,
    }));
  }, [planFollowup.planItemId, threadId]);

  return {
    bottomRef,
    containerRef,
    updateAutoScroll,
    requestAutoScroll,
    expandedItems,
    toggleExpanded,
    collapsedToolGroups,
    toggleToolGroup,
    reasoningMetaById,
    latestReasoningLabel,
    groupedItems,
    virtualizer,
    tailIndex,
    planFollowup,
    dismissPlanFollowup,
  };
}
