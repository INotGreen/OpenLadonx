import type { AccessMode, ConversationItem, ServiceTier } from "@/types";
import { sanitizeConversationItems } from "@utils/threadItems";

const STORAGE_KEY_THREAD_ACTIVITY = "codexmonitor.threadLastUserActivity";
export const STORAGE_KEY_PINNED_THREADS = "codexmonitor.pinnedThreads";
export const STORAGE_KEY_CUSTOM_NAMES = "codexmonitor.threadCustomNames";
export const STORAGE_KEY_THREAD_CODEX_PARAMS = "codexmonitor.threadCodexParams";
export const STORAGE_KEY_DETACHED_REVIEW_LINKS = "codexmonitor.detachedReviewLinks";
export const STORAGE_KEY_THREAD_ITEM_SNAPSHOTS = "codexmonitor.threadItemSnapshots";
export const MAX_PINS_SOFT_LIMIT = 5;
const MAX_THREAD_ITEM_SNAPSHOTS = 80;
const MAX_THREAD_ITEMS_PER_SNAPSHOT = 240;

export type ThreadActivityMap = Record<string, Record<string, number>>;
export type PinnedThreadsMap = Record<string, number>;
export type CustomNamesMap = Record<string, string>;
type DetachedReviewLinksMap = Record<string, Record<string, string>>;
type ThreadItemSnapshot = {
  items: ConversationItem[];
  updatedAt: number;
};
type ThreadItemSnapshotMap = Record<string, ThreadItemSnapshot>;

// Per-thread Codex parameter overrides. Keyed by `${workspaceId}:${threadId}`.
// These are UI-level preferences (not server state) and are best-effort persisted.
export type ThreadCodexParams = {
  modelId: string | null;
  effort: string | null;
  // string => explicit per-thread tier override
  // null => explicit "Default/off" override
  // undefined => legacy/unset thread value that should inherit no-thread scope
  serviceTier: ServiceTier | null | undefined;
  accessMode: AccessMode | null;
  collaborationModeId: string | null;
  // string => explicit per-thread override
  // null => explicit "Default" (no override)
  // undefined => legacy/unset thread value that should inherit no-thread scope
  codexArgsOverride: string | null | undefined;
  updatedAt: number;
};

export type ThreadCodexParamsMap = Record<string, ThreadCodexParams>;

function loadThreadItemSnapshots(): ThreadItemSnapshotMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_THREAD_ITEM_SNAPSHOTS);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as ThreadItemSnapshotMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveThreadItemSnapshots(snapshots: ThreadItemSnapshotMap): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_THREAD_ITEM_SNAPSHOTS,
      JSON.stringify(snapshots),
    );
  } catch {
    // Best-effort persistence.
  }
}

function sanitizeThreadItemSnapshots(snapshots: ThreadItemSnapshotMap) {
  let changed = false;
  const next: ThreadItemSnapshotMap = {};
  for (const [key, snapshot] of Object.entries(snapshots)) {
    const originalItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const sanitizedItems = sanitizeConversationItems(originalItems);
    const originalSerialized = JSON.stringify(originalItems);
    const sanitizedSerialized = JSON.stringify(sanitizedItems);
    if (originalSerialized !== sanitizedSerialized) {
      changed = true;
    }
    if (sanitizedItems.length === 0) {
      changed = true;
      continue;
    }
    next[key] = {
      items: sanitizedItems.slice(-MAX_THREAD_ITEMS_PER_SNAPSHOT),
      updatedAt: snapshot?.updatedAt ?? 0,
    };
  }
  return { snapshots: next, changed };
}

export function makeThreadItemSnapshotKey(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}

export function loadThreadItemSnapshot(
  workspaceId: string,
  threadId: string,
): ConversationItem[] {
  const key = makeThreadItemSnapshotKey(workspaceId, threadId);
  const loadedSnapshots = loadThreadItemSnapshots();
  const { snapshots, changed } = sanitizeThreadItemSnapshots(loadedSnapshots);
  if (changed) {
    saveThreadItemSnapshots(snapshots);
  }
  const snapshot = snapshots[key];
  return Array.isArray(snapshot?.items) ? snapshot.items : [];
}

export function saveThreadItemSnapshot(
  workspaceId: string,
  threadId: string,
  items: ConversationItem[],
  updatedAt = Date.now(),
): void {
  if (!workspaceId || !threadId || items.length === 0) {
    return;
  }
  const key = makeThreadItemSnapshotKey(workspaceId, threadId);
  const { snapshots } = sanitizeThreadItemSnapshots(loadThreadItemSnapshots());
  const sanitizedItems = sanitizeConversationItems(items);
  if (sanitizedItems.length === 0) {
    delete snapshots[key];
    saveThreadItemSnapshots(snapshots);
    return;
  }
  snapshots[key] = {
    items: sanitizedItems.slice(-MAX_THREAD_ITEMS_PER_SNAPSHOT),
    updatedAt,
  };
  const limited = Object.fromEntries(
    Object.entries(snapshots)
      .sort(([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .slice(0, MAX_THREAD_ITEM_SNAPSHOTS),
  );
  saveThreadItemSnapshots(limited);
}

export function sanitizeAllThreadItemSnapshots(): void {
  const { snapshots, changed } = sanitizeThreadItemSnapshots(loadThreadItemSnapshots());
  if (!changed) {
    return;
  }
  saveThreadItemSnapshots(snapshots);
}

export function deleteThreadItemSnapshot(workspaceId: string, threadId: string): void {
  const key = makeThreadItemSnapshotKey(workspaceId, threadId);
  const snapshots = loadThreadItemSnapshots();
  if (!(key in snapshots)) {
    return;
  }
  const { [key]: _removed, ...rest } = snapshots;
  saveThreadItemSnapshots(rest);
}

export function makeThreadCodexParamsKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

export function loadThreadCodexParams(): ThreadCodexParamsMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_THREAD_CODEX_PARAMS);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as ThreadCodexParamsMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function saveThreadCodexParams(next: ThreadCodexParamsMap): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_THREAD_CODEX_PARAMS,
      JSON.stringify(next),
    );
  } catch {
    // Best-effort persistence.
  }
}

export function loadThreadActivity(): ThreadActivityMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_THREAD_ACTIVITY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as ThreadActivityMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function saveThreadActivity(activity: ThreadActivityMap) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_THREAD_ACTIVITY,
      JSON.stringify(activity),
    );
  } catch {
    // Best-effort persistence; ignore write failures.
  }
}

export function deleteThreadActivity(workspaceId: string, threadId: string) {
  const current = loadThreadActivity();
  const workspaceActivity = current[workspaceId];
  if (!workspaceActivity || !(threadId in workspaceActivity)) {
    return;
  }
  const { [threadId]: _removed, ...restWorkspace } = workspaceActivity;
  const next =
    Object.keys(restWorkspace).length > 0
      ? { ...current, [workspaceId]: restWorkspace }
      : Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== workspaceId),
        );
  saveThreadActivity(next);
}

export function makeCustomNameKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

export function loadCustomNames(): CustomNamesMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CUSTOM_NAMES);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as CustomNamesMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function saveCustomName(workspaceId: string, threadId: string, name: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const current = loadCustomNames();
    const key = makeCustomNameKey(workspaceId, threadId);
    current[key] = name;
    window.localStorage.setItem(
      STORAGE_KEY_CUSTOM_NAMES,
      JSON.stringify(current),
    );
  } catch {
    // Best-effort persistence.
  }
}

export function deleteCustomName(workspaceId: string, threadId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const current = loadCustomNames();
    const key = makeCustomNameKey(workspaceId, threadId);
    if (!(key in current)) {
      return;
    }
    const { [key]: _removed, ...rest } = current;
    window.localStorage.setItem(
      STORAGE_KEY_CUSTOM_NAMES,
      JSON.stringify(rest),
    );
  } catch {
    // Best-effort persistence.
  }
}

export function makePinKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

export function loadPinnedThreads(): PinnedThreadsMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PINNED_THREADS);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PinnedThreadsMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function savePinnedThreads(pinned: PinnedThreadsMap) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_PINNED_THREADS,
      JSON.stringify(pinned),
    );
  } catch {
    // Best-effort persistence; ignore write failures.
  }
}

export function deletePinnedThread(workspaceId: string, threadId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const current = loadPinnedThreads();
    const key = makePinKey(workspaceId, threadId);
    if (!(key in current)) {
      return;
    }
    const { [key]: _removed, ...rest } = current;
    window.localStorage.setItem(
      STORAGE_KEY_PINNED_THREADS,
      JSON.stringify(rest),
    );
  } catch {
    // Best-effort persistence; ignore write failures.
  }
}

export function loadDetachedReviewLinks(): DetachedReviewLinksMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_DETACHED_REVIEW_LINKS);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as DetachedReviewLinksMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function saveDetachedReviewLinks(links: DetachedReviewLinksMap) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_DETACHED_REVIEW_LINKS,
      JSON.stringify(links),
    );
  } catch {
    // Best-effort persistence; ignore write failures.
  }
}

export function deleteDetachedReviewLink(workspaceId: string, threadId: string) {
  const current = loadDetachedReviewLinks();
  const workspaceLinks = current[workspaceId];
  if (!workspaceLinks || !(threadId in workspaceLinks)) {
    return;
  }
  const { [threadId]: _removed, ...restWorkspace } = workspaceLinks;
  const next =
    Object.keys(restWorkspace).length > 0
      ? { ...current, [workspaceId]: restWorkspace }
      : Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== workspaceId),
        );
  saveDetachedReviewLinks(next);
}

export function purgeThreadPersistence(workspaceId: string, threadId: string): void {
  deleteThreadItemSnapshot(workspaceId, threadId);
  deleteThreadActivity(workspaceId, threadId);
  deleteCustomName(workspaceId, threadId);
  deletePinnedThread(workspaceId, threadId);

  const currentParams = loadThreadCodexParams();
  const paramsKey = makeThreadCodexParamsKey(workspaceId, threadId);
  if (paramsKey in currentParams) {
    const { [paramsKey]: _removed, ...rest } = currentParams;
    saveThreadCodexParams(rest);
  }

  deleteDetachedReviewLink(workspaceId, threadId);
}
