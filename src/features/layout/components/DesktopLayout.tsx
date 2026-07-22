import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { ChatPane } from "./ChatPane";
import { MainTopbar } from "@/features/app/components/MainTopbar";

type CenterMode = "chat" | "diff";

function isActiveLayer(centerMode: CenterMode, layer: CenterMode) {
  return centerMode === layer;
}

function layerClassName({
  splitChatDiffView,
  layer,
  isActive,
}: {
  splitChatDiffView: boolean;
  layer: CenterMode;
  isActive: boolean;
}) {
  if (splitChatDiffView) {
    return `content-layer content-layer-split content-layer-${layer}${
      isActive ? " is-active" : ""
    }`;
  }
  return `content-layer ${isActive ? "is-active" : "is-hidden"}`;
}

function setLayerInert(
  layer: HTMLDivElement | null,
  isActive: boolean,
  splitChatDiffView: boolean,
) {
  if (!layer) {
    return;
  }

  if (splitChatDiffView || isActive) {
    layer.removeAttribute("inert");
    return;
  }

  layer.setAttribute("inert", "");
}

type DesktopLayoutProps = {
  sidebarNode: ReactNode;
  updateToastNode: ReactNode;
  approvalToastsNode: ReactNode;
  errorToastsNode: ReactNode;
  successToastsNode: ReactNode;
  homeNode: ReactNode;
  desktopTopbarLeftNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  centerMode: "chat" | "diff";
  splitChatDiffView: boolean;
  messagesNode: ReactNode;
  threadStatusPanelNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  composerNode: ReactNode;
  onAttachFiles?: (paths: string[]) => void;
  terminalNode: ReactNode;
  debugPanelNode: ReactNode;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onChatDiffSplitPositionResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onRightPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onTerminalResizeStart?: (event: MouseEvent<HTMLDivElement>) => void;
};

export function DesktopLayout({
  sidebarNode,
  updateToastNode,
  approvalToastsNode,
  errorToastsNode,
  successToastsNode,
  homeNode,
  desktopTopbarLeftNode,
  showHome,
  showWorkspace,
  centerMode,
  splitChatDiffView,
  messagesNode,
  threadStatusPanelNode,
  gitDiffPanelNode,
  composerNode,
  onAttachFiles,
  terminalNode,
  debugPanelNode,
  onSidebarResizeStart,
  onRightPanelResizeStart,
  onChatDiffSplitPositionResizeStart,
  onTerminalResizeStart,
}: DesktopLayoutProps) {
  const diffLayerRef = useRef<HTMLDivElement | null>(null);
  const chatLayerRef = useRef<HTMLDivElement | null>(null);
  const diffLayerActive = isActiveLayer(centerMode, "diff");
  const chatLayerActive = isActiveLayer(centerMode, "chat");
  useEffect(() => {
    const diffLayer = diffLayerRef.current;
    const chatLayer = chatLayerRef.current;
    setLayerInert(diffLayer, diffLayerActive, splitChatDiffView);
    setLayerInert(chatLayer, chatLayerActive, splitChatDiffView);

    if (splitChatDiffView) {
      return;
    }

    const hiddenLayer = diffLayerActive ? chatLayer : diffLayer;
    const activeElement = document.activeElement;
    if (
      hiddenLayer &&
      activeElement instanceof HTMLElement &&
      hiddenLayer.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }, [chatLayerActive, diffLayerActive, splitChatDiffView]);

  return (
    <>
      {sidebarNode}
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={onSidebarResizeStart}
      />

    <section className="main">
        {updateToastNode}
        {errorToastsNode}
        {successToastsNode}
        {showHome && homeNode}

        {showWorkspace && (
          <>
            <MainTopbar leftNode={desktopTopbarLeftNode} />
            {approvalToastsNode}
            <div className={`content${splitChatDiffView ? " content-split" : ""}`}>
              {splitChatDiffView ? (
                <>
                  <div
                    className={layerClassName({
                      splitChatDiffView,
                      layer: "chat",
                      isActive: chatLayerActive,
                    })}
                    ref={chatLayerRef}
                  >
                    <ChatPane
                      messagesNode={messagesNode}
                      statusPanelNode={threadStatusPanelNode}
                      composerNode={composerNode}
                      onAttachFiles={onAttachFiles}
                      terminalNode={terminalNode} onTerminalResizeStart={onTerminalResizeStart}
                    />
                  </div>
                  <div
                    className="content-split-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize chat/diff split"
                    onMouseDown={onChatDiffSplitPositionResizeStart}
                  />
                  <div
                    className={layerClassName({
                      splitChatDiffView,
                      layer: "diff",
                      isActive: diffLayerActive,
                    })}
                    ref={diffLayerRef}
                  >
                  </div>
                </>
              ) : (
                <>
                  <div
                    className={layerClassName({
                      splitChatDiffView,
                      layer: "diff",
                      isActive: diffLayerActive,
                    })}
                    aria-hidden={!splitChatDiffView ? !diffLayerActive : undefined}
                    ref={diffLayerRef}
                  >
                  </div>
                  <div
                    className={layerClassName({
                      splitChatDiffView,
                      layer: "chat",
                      isActive: chatLayerActive,
                    })}
                    aria-hidden={!splitChatDiffView ? !chatLayerActive : undefined}
                    ref={chatLayerRef}
                  >
                    <ChatPane
                      messagesNode={messagesNode}
                      statusPanelNode={threadStatusPanelNode}
                      composerNode={composerNode}
                      onAttachFiles={onAttachFiles}
                      terminalNode={terminalNode} onTerminalResizeStart={onTerminalResizeStart}
                    />
                  </div>
                </>
              )}
            </div>
            {debugPanelNode}
          </>
        )}
      </section>
      {showWorkspace && (
        <>
          <div
            className="right-panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            onMouseDown={onRightPanelResizeStart}
          />
          <div className="right-panel">
            <div className="right-panel-drag-strip" />
            <div className="right-panel-top">{gitDiffPanelNode}</div>
          </div>
        </>
      )}
    </>
  );
}
