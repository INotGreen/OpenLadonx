import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import { ChatPane } from "./ChatPane";

type PhoneLayoutProps = {
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  successToastsNode: ReactNode;
  tabBarNode: ReactNode;
  homeNode: ReactNode;
  sidebarNode: ReactNode;
  activeTab: "home" | "projects" | "chat" | "git" | "log";
  activeWorkspace: boolean;
  compactEmptyChatNode: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  terminalNode: ReactNode;
  onAttachFiles?: (paths: string[]) => void;
  filePreviewPanelNode: ReactNode;
};

export function PhoneLayout({
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  successToastsNode,
  tabBarNode,
  homeNode,
  sidebarNode,
  activeTab,
  activeWorkspace,
  compactEmptyChatNode,
  messagesNode,
  composerNode,
  terminalNode,
  onAttachFiles,
  filePreviewPanelNode,
}: PhoneLayoutProps) {
  const [isNavCollapsed, setIsNavCollapsed] = useState(true);

  useEffect(() => {
    setIsNavCollapsed(true);
  }, [activeTab]);

  const collapseNavForChatInteraction = () => {
    setIsNavCollapsed(true);
  };

  return (
    <div className={`compact-shell phone-shell${isNavCollapsed ? " is-nav-collapsed" : ""}`}>
      <button
        type="button"
        className="ghost icon-button phone-shell-toggle"
        onClick={() => setIsNavCollapsed((value) => !value)}
        aria-label={isNavCollapsed ? "Expand navigation" : "Collapse navigation"}
        aria-pressed={isNavCollapsed}
      >
        {isNavCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </button>
      {approvalToastsNode}
      {updateToastNode}
      {errorToastsNode}
      {successToastsNode}
      <div
        className={`phone-sidebar-backdrop${isNavCollapsed ? "" : " is-open"}`}
        onClick={() => setIsNavCollapsed(true)}
        aria-hidden={isNavCollapsed}
      />
      <aside
        className={`phone-sidebar-drawer${isNavCollapsed ? "" : " is-open"}`}
        aria-hidden={isNavCollapsed}
      >
        {sidebarNode}
      </aside>
      {activeTab === "home" && (
        <div className="compact-panel" onPointerDownCapture={collapseNavForChatInteraction}>
          {homeNode}
        </div>
      )}
      {activeTab === "projects" && (
        <div className="compact-panel" onPointerDownCapture={collapseNavForChatInteraction}>
          {homeNode}
        </div>
      )}
      {activeTab === "chat" && (
        <div className="compact-panel">
          {activeWorkspace ? (
            <>
              <div
                className="content compact-content"
                onFocusCapture={collapseNavForChatInteraction}
                onPointerDownCapture={collapseNavForChatInteraction}
              >
                <ChatPane
                  messagesNode={messagesNode}
                  composerNode={composerNode}
                  terminalNode={terminalNode}
                  onAttachFiles={onAttachFiles}
                />
              </div>
            </>
          ) : (
            compactEmptyChatNode
          )}
        </div>
      )}
      {activeTab === "log" && (
        <div className="compact-panel" onPointerDownCapture={collapseNavForChatInteraction}>
          {filePreviewPanelNode}
        </div>
      )}
      <div className={`phone-shell-nav${isNavCollapsed ? " is-collapsed" : ""}`}>
        {tabBarNode}
      </div>
    </div>
  );
}
