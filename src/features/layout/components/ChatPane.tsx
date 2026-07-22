import {
  useEffect,
  useRef,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useComposerImageDrop } from "../../composer/hooks/useComposerImageDrop";

type ChatPaneProps = {
  messagesNode: ReactNode;
  statusPanelNode?: ReactNode;
  composerNode: ReactNode;
  terminalNode?: ReactNode;
  className?: string;
  disabledDrop?: boolean;
  onAttachFiles?: (paths: string[]) => void;
  onTerminalResizeStart?: (event: MouseEvent<HTMLDivElement>) => void;
};

export function ChatPane({
  messagesNode,
  statusPanelNode,
  composerNode,
  terminalNode,
  className,
  disabledDrop = false,
  onAttachFiles,
  onTerminalResizeStart,
}: ChatPaneProps) {
  const composerRef = useRef<HTMLDivElement | null>(null);
  const chatPaneRef = useRef<HTMLDivElement | null>(null);
  const hasComposer = Boolean(composerNode);
  const hasStatusPanel = Boolean(statusPanelNode);
  const attachDroppedFiles = (paths: string[]) => {
    const normalized = Array.from(
      new Set(paths.map((path) => path.trim()).filter(Boolean)),
    );
    if (normalized.length === 0) {
      return;
    }
    onAttachFiles?.(normalized);
  };
  const {
    dropTargetRef,
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  } = useComposerImageDrop({
    disabled: disabledDrop || !onAttachFiles,
    onAttachFiles: attachDroppedFiles,
  });

  useEffect(() => {
    const pane = chatPaneRef.current;
    if (!pane) {
      return;
    }

    if (!hasComposer) {
      pane.style.setProperty("--composer-overlay-height", "0px");
      return;
    }

    const node = composerRef.current;
    if (!node) {
      return;
    }

    const updateComposerHeight = () => {
      pane.style.setProperty(
        "--composer-overlay-height",
        `${Math.ceil(node.getBoundingClientRect().height)}px`,
      );
    };

    updateComposerHeight();

    const observer = new ResizeObserver(() => {
      updateComposerHeight();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasComposer]);

  const handleMessagesDragOver = (event: DragEvent<HTMLDivElement>) => {
    handleDragOver(event);
    if (event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  const handleMessagesDragEnter = (event: DragEvent<HTMLDivElement>) => {
    handleDragEnter(event);
    if (event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  const handleMessagesDrop = (event: DragEvent<HTMLDivElement>) => {
    void handleDrop(event);
    if (event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  return (
    <div
      ref={chatPaneRef}
      className={`chat-pane${className ? ` ${className}` : ""}${isDragOver ? " is-drag-over" : ""}${hasStatusPanel ? " has-thread-status" : ""}`}
    >
      <div
        className="chat-pane-messages"
        ref={(node) => {
          dropTargetRef.current = node;
        }}
        onDragOverCapture={handleMessagesDragOver}
        onDragEnterCapture={handleMessagesDragEnter}
        onDragLeaveCapture={handleDragLeave}
        onDropCapture={handleMessagesDrop}
      >
        <div className="chat-pane-thread">
          {messagesNode}
          {statusPanelNode ? (
            <div className="chat-pane-status">{statusPanelNode}</div>
          ) : null}
        </div>
        <div className="chat-pane-drop-overlay" aria-hidden>
          <div className="chat-pane-drop-card">
            <span className="chat-pane-drop-icon">+</span>
            <span className="chat-pane-drop-title">Drop files to attach</span>
            <span className="chat-pane-drop-subtitle">
              They will be inserted into the composer
            </span>
          </div>
        </div>
      </div>
      {composerNode ? (
        <div className="chat-pane-composer" ref={composerRef}>
          {composerNode}
        </div>
      ) : null}
      {terminalNode ? (
        <div className="chat-pane-terminal">
          {onTerminalResizeStart ? (
            <div
              className="terminal-divider"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              onMouseDown={onTerminalResizeStart}
            />
          ) : null}
          {terminalNode}
        </div>
      ) : null}
    </div>
  );
}
