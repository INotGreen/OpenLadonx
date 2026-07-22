import { memo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { DesktopLayout } from "../../layout/components/DesktopLayout";
import { PhoneLayout } from "../../layout/components/PhoneLayout";
type AppLayoutProps = {
  isPhone: boolean;
  showHome: boolean;
  activeTab: "home" | "projects" | "chat" | "git" | "log";
  centerMode: "chat" | "diff";
  splitChatDiffView: boolean;
  activeWorkspace: boolean;
  sidebarNode: ReactNode;
  messagesNode: ReactNode;
  threadStatusPanelNode: ReactNode;
  filePreviewPanelNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  composerNode: ReactNode;
  onAttachFiles?: (paths: string[]) => void;
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  successToastsNode: ReactNode;
  homeNode: ReactNode;
  desktopTopbarLeftNode: ReactNode;
  tabBarNode: ReactNode;
  debugPanelNode: ReactNode;
  terminalNode: ReactNode;
  compactEmptyChatNode: ReactNode;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onChatDiffSplitPositionResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onRightPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onTerminalResizeStart?: (event: MouseEvent<HTMLDivElement>) => void;
  onToggleTerminal?: () => void;
};

export const AppLayout = memo(function AppLayout({
  isPhone,
  showHome,
  activeTab,
  centerMode,
  splitChatDiffView,
  activeWorkspace,
  sidebarNode,
  messagesNode,
  threadStatusPanelNode,
  filePreviewPanelNode,
  gitDiffPanelNode,
  composerNode,
  onAttachFiles,
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  successToastsNode,
  homeNode,
  desktopTopbarLeftNode,
  tabBarNode,
  debugPanelNode,
  terminalNode,
  compactEmptyChatNode,
  onSidebarResizeStart,
  onChatDiffSplitPositionResizeStart,
  onRightPanelResizeStart,
  onTerminalResizeStart,
}: AppLayoutProps) {
  if (isPhone) {
    return (
      <PhoneLayout
        approvalToastsNode={approvalToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        successToastsNode={successToastsNode}
        tabBarNode={tabBarNode}
        homeNode={homeNode}
        sidebarNode={sidebarNode}
        activeTab={activeTab}
        activeWorkspace={activeWorkspace}
        compactEmptyChatNode={compactEmptyChatNode}
        messagesNode={messagesNode}
        composerNode={composerNode}
        terminalNode={terminalNode}
        onAttachFiles={onAttachFiles}
        filePreviewPanelNode={filePreviewPanelNode}
      />
    );
  }

  return (
    <DesktopLayout
      sidebarNode={sidebarNode}
      updateToastNode={updateToastNode}
      approvalToastsNode={approvalToastsNode}
      errorToastsNode={errorToastsNode}
      successToastsNode={successToastsNode}
      homeNode={homeNode}
      desktopTopbarLeftNode={desktopTopbarLeftNode}
      showHome={showHome}
      showWorkspace={activeWorkspace && !showHome}
      centerMode={centerMode}
      splitChatDiffView={splitChatDiffView}
      messagesNode={messagesNode}
      threadStatusPanelNode={threadStatusPanelNode}
      gitDiffPanelNode={gitDiffPanelNode}
      composerNode={composerNode}
      onAttachFiles={onAttachFiles}
      terminalNode={terminalNode}
      debugPanelNode={debugPanelNode}
      onSidebarResizeStart={onSidebarResizeStart}
      onChatDiffSplitPositionResizeStart={onChatDiffSplitPositionResizeStart}
      onRightPanelResizeStart={onRightPanelResizeStart}
      onTerminalResizeStart={onTerminalResizeStart}
    />
  );
});
