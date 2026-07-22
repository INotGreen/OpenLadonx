import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY_SIDEBAR = "codexmonitor.sidebarWidth";
const STORAGE_KEY_RIGHT_PANEL = "codexmonitor.rightPanelWidthPercent";
const LEGACY_STORAGE_KEY_RIGHT_PANEL = "codexmonitor.rightPanelWidth";
const STORAGE_KEY_CHAT_DIFF_SPLIT_POSITION_PERCENT =
  "codexmonitor.chatDiffSplitPositionPercent";
const STORAGE_KEY_TERMINAL_PANEL = "codexmonitor.terminalPanelHeight";
const STORAGE_KEY_DEBUG_PANEL = "codexmonitor.debugPanelHeight";
const MIN_SIDEBAR_WIDTH = 220; // 最小宽度
const MAX_SIDEBAR_WIDTH = 320; // 最大宽度
const MIN_CHAT_DIFF_SPLIT_POSITION_PERCENT = 20; // 最小宽度
const MAX_CHAT_DIFF_SPLIT_POSITION_PERCENT = 80; // 最大宽度
const MIN_RIGHT_PANEL_WIDTH_PERCENT = 14; // 右侧工作区最小宽度占比
const MAX_RIGHT_PANEL_WIDTH_PERCENT = 80; // 右侧工作区最大宽度占比
const MIN_CENTER_PANEL_WIDTH_PERCENT = 20; // 中间工作区最小占比
const MIN_TERMINAL_PANEL_HEIGHT = 140; // 最小宽度
const MAX_TERMINAL_PANEL_HEIGHT = 720; // 最大宽度
const MIN_DEBUG_PANEL_HEIGHT = 120; // 最小宽度
const MAX_DEBUG_PANEL_HEIGHT = 240; // 最大宽度
const DEFAULT_SIDEBAR_WIDTH = 280; // 默认宽度
const DEFAULT_CHAT_DIFF_SPLIT_POSITION_PERCENT = 50; // 默认宽度
const DEFAULT_RIGHT_PANEL_WIDTH_PERCENT = 20; // 默认宽度占比
const DEFAULT_TERMINAL_PANEL_HEIGHT = 220; // 默认宽度
const DEFAULT_DEBUG_PANEL_HEIGHT = 180; // 默认宽度

type ResizeState = {
  type:
    | "sidebar"
    | "right-panel"
    | "chat-diff-split"
    | "terminal-panel"
    | "debug-panel";
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startContainerWidth?: number;
  startContainerLeft?: number;
};

const CSS_VAR_MAP: Record<
  ResizeState["type"],
  { prop: string; unit: string }
> = {
  sidebar: { prop: "--sidebar-width", unit: "px" },
  "right-panel": { prop: "--right-panel-width", unit: "px" },
  "chat-diff-split": {
    prop: "--chat-diff-split-position-percent",
    unit: "%",
  },
  "terminal-panel": { prop: "--terminal-panel-height", unit: "px" },
  "debug-panel": { prop: "--debug-panel-height", unit: "px" },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth(key: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function getAppWidth() {
  return window.innerWidth || 1;
}

function getWorkspaceAreaWidth(sidebarWidth: number, containerWidth: number) {
  return Math.max(containerWidth - sidebarWidth, 1);
}

function getRightPanelWidthPixels(sidebarWidth: number, ratio: number, containerWidth: number) {
  return (getWorkspaceAreaWidth(sidebarWidth, containerWidth) * ratio) / 100;
}

function getRightPanelPercentBounds() {
  const maxByCenter = 100 - MIN_CENTER_PANEL_WIDTH_PERCENT;
  const max = Math.min(MAX_RIGHT_PANEL_WIDTH_PERCENT, Math.max(0, maxByCenter));
  const min = Math.min(MIN_RIGHT_PANEL_WIDTH_PERCENT, max);
  return { min, max };
}

function readStoredRightPanelWidthPercent(sidebarWidth: number) {
  if (typeof window === "undefined") {
    return DEFAULT_RIGHT_PANEL_WIDTH_PERCENT;
  }

  const bounds = getRightPanelPercentBounds();
  const raw = window.localStorage.getItem(STORAGE_KEY_RIGHT_PANEL);
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return clamp(parsed, bounds.min, bounds.max);
    }
  }

  const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY_RIGHT_PANEL);
  if (legacyRaw) {
    const parsed = Number(legacyRaw);
    if (Number.isFinite(parsed)) {
      return clamp(
        (parsed / getWorkspaceAreaWidth(sidebarWidth, getAppWidth())) * 100,
        bounds.min,
        bounds.max,
      );
    }
  }

  return clamp(DEFAULT_RIGHT_PANEL_WIDTH_PERCENT, bounds.min, bounds.max);
}

function getContainerPointerPercent(event: MouseEvent, resize: ResizeState) {
  const containerWidth = resize.startContainerWidth ?? 1;
  const containerLeft = resize.startContainerLeft ?? 0;
  return ((event.clientX - containerLeft) / containerWidth) * 100;
}

export function useResizablePanels() {
  const [appWidth, setAppWidth] = useState(() => getAppWidth());
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredWidth(
      STORAGE_KEY_SIDEBAR,
      DEFAULT_SIDEBAR_WIDTH,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    ),
  );
  const [chatDiffSplitPositionPercent, setChatDiffSplitPositionPercent] =
    useState(() =>
      readStoredWidth(
        STORAGE_KEY_CHAT_DIFF_SPLIT_POSITION_PERCENT,
        DEFAULT_CHAT_DIFF_SPLIT_POSITION_PERCENT,
        MIN_CHAT_DIFF_SPLIT_POSITION_PERCENT,
        MAX_CHAT_DIFF_SPLIT_POSITION_PERCENT,
      ),
    );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredRightPanelWidthPercent(sidebarWidth),
  );
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(() =>
    readStoredWidth(
      STORAGE_KEY_TERMINAL_PANEL,
      DEFAULT_TERMINAL_PANEL_HEIGHT,
      MIN_TERMINAL_PANEL_HEIGHT,
      MAX_TERMINAL_PANEL_HEIGHT,
    ),
  );
  const [debugPanelHeight, setDebugPanelHeight] = useState(() =>
    readStoredWidth(
      STORAGE_KEY_DEBUG_PANEL,
      DEFAULT_DEBUG_PANEL_HEIGHT,
      MIN_DEBUG_PANEL_HEIGHT,
      MAX_DEBUG_PANEL_HEIGHT,
    ),
  );
  const resizeRef = useRef<ResizeState | null>(null);
  const appRef = useRef<HTMLDivElement | null>(null);
  const liveValueRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const rightPanelWidthPx = getRightPanelWidthPixels(sidebarWidth, rightPanelWidth, appWidth);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY_SIDEBAR, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY_CHAT_DIFF_SPLIT_POSITION_PERCENT,
      String(chatDiffSplitPositionPercent),
    );
  }, [chatDiffSplitPositionPercent]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY_RIGHT_PANEL,
      String(rightPanelWidth),
    );
  }, [rightPanelWidth]);

  useEffect(() => {
    const bounds = getRightPanelPercentBounds();
    setRightPanelWidth((current) => clamp(current, bounds.min, bounds.max));
  }, [sidebarWidth]);

  useEffect(() => {
    function handleResize() {
      setAppWidth(getAppWidth());
      const bounds = getRightPanelPercentBounds();
      setRightPanelWidth((current) => clamp(current, bounds.min, bounds.max));
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY_TERMINAL_PANEL,
      String(terminalPanelHeight),
    );
  }, [terminalPanelHeight]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY_DEBUG_PANEL,
      String(debugPanelHeight),
    );
  }, [debugPanelHeight]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const resize = resizeRef.current;
      const el = appRef.current;
      if (!resize || !el) {
        return;
      }
      event.preventDefault();

      let next: number;
      if (resize.type === "sidebar") {
        const delta = event.clientX - resize.startX;
        next = clamp(
          resize.startWidth + delta,
          MIN_SIDEBAR_WIDTH,
          MAX_SIDEBAR_WIDTH,
        );
      } else if (resize.type === "chat-diff-split") {
        const pointerPercent = getContainerPointerPercent(event, resize);
        next = clamp(
          pointerPercent,
          MIN_CHAT_DIFF_SPLIT_POSITION_PERCENT,
          MAX_CHAT_DIFF_SPLIT_POSITION_PERCENT,
        );
      } else if (resize.type === "right-panel") {
        const pointerPercent = getContainerPointerPercent(event, resize);
        const nextPercent = 100 - pointerPercent;
        const bounds = getRightPanelPercentBounds();
        next = clamp(
          nextPercent,
          bounds.min,
          bounds.max,
        );
      } else if (resize.type === "terminal-panel") {
        const delta = event.clientY - resize.startY;
        next = clamp(
          resize.startHeight - delta,
          MIN_TERMINAL_PANEL_HEIGHT,
          MAX_TERMINAL_PANEL_HEIGHT,
        );
      } else {
        const delta = event.clientY - resize.startY;
        next = clamp(
          resize.startHeight - delta,
          MIN_DEBUG_PANEL_HEIGHT,
          MAX_DEBUG_PANEL_HEIGHT,
        );
      }

      liveValueRef.current = next;
      if (resize.type === "right-panel") {
        const nextPixels = getRightPanelWidthPixels(
          sidebarWidth,
          next,
          (resize.startContainerWidth ?? 1) + sidebarWidth,
        );
        el.style.setProperty("--right-panel-width", `${nextPixels}px`);
      } else {
        const { prop, unit } = CSS_VAR_MAP[resize.type];
        el.style.setProperty(prop, `${next}${unit}`);
      }
    }

    function handleMouseUp() {
      const resize = resizeRef.current;
      if (!resize) {
        return;
      }
      const finalValue = liveValueRef.current;
      if (finalValue !== null) {
        switch (resize.type) {
          case "sidebar":
            setSidebarWidth(finalValue);
            break;
          case "chat-diff-split":
            setChatDiffSplitPositionPercent(finalValue);
            break;
          case "right-panel":
            setRightPanelWidth(finalValue);
            break;
          case "terminal-panel":
            setTerminalPanelHeight(finalValue);
            break;
          case "debug-panel":
            setDebugPanelHeight(finalValue);
            break;
        }
      }
      resizeRef.current = null;
      liveValueRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsResizing(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarWidth]);

  const onSidebarResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      resizeRef.current = {
        type: "sidebar",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: sidebarWidth,
        startHeight: 0,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);
    },
    [sidebarWidth],
  );

  const preserveSidebarWidth = useCallback(
    (width?: number | null) => {
      const nextWidth = clamp(
        Number.isFinite(width ?? NaN) ? Number(width) : sidebarWidth,
        MIN_SIDEBAR_WIDTH,
        MAX_SIDEBAR_WIDTH,
      );
      appRef.current?.style.setProperty("--sidebar-width", `${nextWidth}px`);
      setSidebarWidth(nextWidth);
    },
    [sidebarWidth],
  );

  const onChatDiffSplitPositionResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      const content = event.currentTarget.closest(".content-split") as
        | HTMLDivElement
        | null;
      resizeRef.current = {
        type: "chat-diff-split",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: chatDiffSplitPositionPercent,
        startHeight: 0,
        startContainerWidth: content?.clientWidth,
        startContainerLeft: content?.getBoundingClientRect().left,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);
    },
    [chatDiffSplitPositionPercent],
  );

  const onRightPanelResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      resizeRef.current = {
        type: "right-panel",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rightPanelWidth,
        startHeight: 0,
        startContainerWidth: getWorkspaceAreaWidth(
          sidebarWidth,
          appRef.current?.clientWidth ?? getAppWidth(),
        ),
        startContainerLeft:
          (appRef.current?.getBoundingClientRect().left ?? 0) + sidebarWidth,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);
    },
    [rightPanelWidth, sidebarWidth],
  );

  const onTerminalPanelResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      resizeRef.current = {
        type: "terminal-panel",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rightPanelWidth,
        startHeight: terminalPanelHeight,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);
    },
    [rightPanelWidth, terminalPanelHeight],
  );

  const onDebugPanelResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      resizeRef.current = {
        type: "debug-panel",
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rightPanelWidth,
        startHeight: debugPanelHeight,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);
    },
    [debugPanelHeight, rightPanelWidth],
  );

  return {
    appRef,
    isResizing,
    sidebarWidth,
    preserveSidebarWidth,
    rightPanelWidth,
    rightPanelWidthPx,
    terminalPanelHeight,
    debugPanelHeight,
    onSidebarResizeStart,
    chatDiffSplitPositionPercent,
    onChatDiffSplitPositionResizeStart,
    onRightPanelResizeStart,
    onTerminalPanelResizeStart,
    onDebugPanelResizeStart,
  };
}
