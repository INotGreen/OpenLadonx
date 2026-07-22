import type { MouseEvent, ReactNode } from "react";
import { ChatPane } from "./ChatPane";

type TabletLayoutProps = {
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  successToastsNode: ReactNode;
  homeNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  sidebarNode: ReactNode;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  terminalNode: ReactNode;
  onAttachFiles?: (paths: string[]) => void;
};

export function TabletLayout({
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  successToastsNode,
  homeNode,
  showHome,
  showWorkspace,
  sidebarNode,
  onSidebarResizeStart,
  messagesNode,
  composerNode,
  terminalNode,
  onAttachFiles,
}: TabletLayoutProps) {
  return (
    <>
      <div className="tablet-projects">{sidebarNode}</div>
      <div
        className="projects-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize projects"
        onMouseDown={onSidebarResizeStart}
      />
      <section className="tablet-main">
        {approvalToastsNode}
        {updateToastNode}
        {errorToastsNode}
        {successToastsNode}
        {showHome && homeNode}
        {showWorkspace && (
          <>
            <div className="content tablet-content">
              <ChatPane
                messagesNode={messagesNode}
                composerNode={composerNode}
                terminalNode={terminalNode}
                onAttachFiles={onAttachFiles}
              />
            </div>
          </>
        )}
      </section>
    </>
  );
}
