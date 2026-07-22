import { useLayoutMode } from "../../layout/hooks/useLayoutMode";
import { useResizablePanels } from "../../layout/hooks/useResizablePanels";
import { useSidebarToggles } from "../../layout/hooks/useSidebarToggles";
import { usePanelVisibility } from "../../layout/hooks/usePanelVisibility";
import { usePanelShortcuts } from "../../layout/hooks/usePanelShortcuts";

export function useLayoutController({
  onToggleTerminal,
  setActiveTab,
  setDebugOpen,
  toggleDebugPanelShortcut,
  toggleTerminalShortcut,
}: {
  onToggleTerminal: () => void;
  setActiveTab: (tab: "home" | "projects" | "chat" | "git" | "log") => void;
  setDebugOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleDebugPanelShortcut: string | null;
  toggleTerminalShortcut: string | null;
}) {
  const {
    appRef,
    isResizing,
    sidebarWidth,
    rightPanelWidth,
    rightPanelWidthPx,
    chatDiffSplitPositionPercent,
    onSidebarResizeStart,
    preserveSidebarWidth,
    onChatDiffSplitPositionResizeStart,
    onRightPanelResizeStart,
    terminalPanelHeight,
    onTerminalPanelResizeStart,
    debugPanelHeight,
    onDebugPanelResizeStart,
  } = useResizablePanels();

  const layoutMode = useLayoutMode();
  const isCompact = layoutMode !== "desktop";
  const isPhone = layoutMode === "phone";

  const {
    sidebarCollapsed,
    rightPanelCollapsed,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
  } = useSidebarToggles({ isCompact });

  const { onToggleDebug: handleDebugClick } = usePanelVisibility({
    isCompact,
    setActiveTab,
    setDebugOpen,
  });

  usePanelShortcuts({
    toggleDebugPanelShortcut,
    toggleTerminalShortcut,
    onToggleDebug: handleDebugClick,
    onToggleTerminal,
  });

  return {
    appRef,
    isResizing,
    layoutMode,
    isCompact,
    isPhone,
    sidebarWidth,
    rightPanelWidth,
    rightPanelWidthPx,
    chatDiffSplitPositionPercent,
    terminalPanelHeight,
    debugPanelHeight,
    onSidebarResizeStart,
    preserveSidebarWidth,
    onChatDiffSplitPositionResizeStart,
    onRightPanelResizeStart,
    onTerminalPanelResizeStart,
    onDebugPanelResizeStart,
    sidebarCollapsed,
    rightPanelCollapsed,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    handleDebugClick,
  };
}
