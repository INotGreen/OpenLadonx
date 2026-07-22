import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Folder from "lucide-react/dist/esm/icons/folder";
import Globe from "lucide-react/dist/esm/icons/globe";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import MessageCirclePlus from "lucide-react/dist/esm/icons/message-circle-plus";
import Plus from "lucide-react/dist/esm/icons/plus";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import X from "lucide-react/dist/esm/icons/x";
import { BrowersPreviewPanel } from "./BrowersPreviewPanel";
import { CanvasPreviewPanel } from "./CanvasPreviewPanel";
import { CANVAS_PREVIEW_PATH, FILE_TREE_PREVIEW_PATH, FilePreviewPanel, fileTitle, previewTabIconUrl, type FilePreviewPanelProps } from "./FilePreviewPanel";
import { PanelShell } from "../../layout/components/PanelShell";

function isBrowserPreview(path: string | null) {
  return Boolean(path?.startsWith("browser:"));
}

function isCanvasPreview(path: string | null) {
  return path === CANVAS_PREVIEW_PATH;
}

function PreviewAddPanel({ onPickFile, onOpenBrowser, onSideChat, onTerminal, onOpenCanvas }: { onPickFile: () => void; onOpenBrowser: () => void; onSideChat?: () => void; onTerminal?: () => void; onOpenCanvas: () => void }) {
  const { t } = useTranslation();
  const actions = [
    { icon: <LayoutGrid size={15} aria-hidden />, title: t("filePreview.infiniteCanvas"), subtitle: t("filePreview.visualCanvas"), shortcut: "⌃⇧G", onClick: onOpenCanvas },
    { icon: <TerminalSquare size={15} aria-hidden />, title: t("filePreview.terminal"), subtitle: t("filePreview.startInteractiveShell"), onClick: onTerminal },
    { icon: <Globe size={15} aria-hidden />, title: t("filePreview.webPage"), subtitle: t("filePreview.previewOrExternal"), shortcut: "⌘T", onClick: onOpenBrowser },
    { icon: <Folder size={15} aria-hidden />, title: t("filePreview.file"), subtitle: t("filePreview.browseProjectFiles"), shortcut: "⌘P", onClick: onPickFile },
    { icon: <MessageCirclePlus size={15} aria-hidden />, title: t("filePreview.sideChat"), subtitle: t("filePreview.startSideConversation"), shortcut: "⌥⌘S", onClick: onSideChat },
  ];

  return (
    <div className="file-preview-add-panel" aria-label="Add preview tab">
      <div className="file-preview-add-list" role="list">
        {actions.map((action) => (
          <button key={action.title} type="button" className="file-preview-add-card" aria-label={action.title} onClick={action.onClick} disabled={!action.onClick}>
            <span className="file-preview-add-card-main">
              <span className="file-preview-add-card-icon">{action.icon}</span>
              <span className="file-preview-add-card-copy">
                <span className="file-preview-add-card-title">{action.title}</span>
              </span>
            </span>
            {action.shortcut ? <span className="file-preview-add-card-shortcut" aria-hidden>{action.shortcut}</span> : <span className="file-preview-add-card-shortcut file-preview-add-card-shortcut--empty" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilePreviewTabBar({ paths, activePath, onPreviewPathChange, onPreviewTabClose }: { paths: string[]; activePath: string | null; onPreviewPathChange?: (path: string | null) => void; onPreviewTabClose?: (path: string) => void }) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [tabbar, setTabbar] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tabbar) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const updateScrollButtons = () => {
      const maxScrollLeft = tabbar.scrollWidth - tabbar.clientWidth;
      setCanScrollLeft(tabbar.scrollLeft > 1);
      setCanScrollRight(tabbar.scrollLeft < maxScrollLeft - 1);
    };
    updateScrollButtons();
    const frameId = requestAnimationFrame(updateScrollButtons);
    tabbar.addEventListener("scroll", updateScrollButtons, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollButtons);
    resizeObserver.observe(tabbar);
    return () => {
      cancelAnimationFrame(frameId);
      tabbar.removeEventListener("scroll", updateScrollButtons);
      resizeObserver.disconnect();
    };
  }, [activePath, paths, tabbar]);

  useEffect(() => {
    tabbar?.querySelector<HTMLElement>(".file-preview-tab.is-active")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activePath, tabbar]);

  const scrollTabs = (direction: "left" | "right") => {
    if (!tabbar) {
      return;
    }
    const distance = Math.max(160, Math.floor(tabbar.clientWidth * 0.75));
    tabbar.scrollBy({ left: direction === "left" ? -distance : distance, behavior: "smooth" });
  };

  return (
    <div className="file-preview-tabbar-wrap">
      <button type="button" className="file-preview-tab-add" data-tauri-drag-region="false" onClick={() => onPreviewPathChange?.(null)} aria-label="Add preview tab" title="Add preview tab">
        <Plus size={15} aria-hidden />
      </button>
      <button type="button" className="file-preview-tab-scroll" data-tauri-drag-region="false" onClick={() => scrollTabs("left")} disabled={!canScrollLeft} aria-label="Scroll preview tabs left" title="Scroll preview tabs left">
        <ChevronLeft size={15} aria-hidden />
      </button>
      <div ref={setTabbar} className="file-preview-tabbar" role="tablist" aria-label="Open previews" data-tauri-drag-region="false">
        {paths.map((path) => (
          <button key={path} type="button" className={`file-preview-tab${path === activePath ? " is-active" : ""}`} data-tauri-drag-region="false" onClick={() => onPreviewPathChange?.(path)} role="tab" aria-selected={path === activePath} title={path}>
            <span className="file-preview-tab-leading">
              <img className="file-preview-tab-file-icon" src={previewTabIconUrl(path)} alt="" aria-hidden />
              <span role="button" className="file-preview-tab-close" aria-label={`Close ${fileTitle(path)}`} onClick={(event) => { event.stopPropagation(); onPreviewTabClose?.(path); }}>
                <X size={12} aria-hidden />
              </span>
            </span>
            <span>{fileTitle(path)}</span>
          </button>
        ))}
      </div>
      <button type="button" className="file-preview-tab-scroll" data-tauri-drag-region="false" onClick={() => scrollTabs("right")} disabled={!canScrollRight} aria-label="Scroll preview tabs right" title="Scroll preview tabs right">
        <ChevronRight size={15} aria-hidden />
      </button>
    </div>
  );
}

export function RightPreview(props: FilePreviewPanelProps) {
  const { workspacePath, filePanelMode, onFilePanelModeChange, previewPath, previewTabs = [], onPreviewPathChange, onPreviewTabClose, onPreviewSideChat, onPreviewTerminal, isPanelVisible = true } = props;
  const visiblePreviewTabs = previewPath && previewPath !== FILE_TREE_PREVIEW_PATH && !previewTabs.includes(previewPath) ? [...previewTabs, previewPath] : previewTabs;
  const isBrowser = isBrowserPreview(previewPath);
  const isCanvas = isCanvasPreview(previewPath);

  const handlePickPreviewFile = async () => {
    const selection = await open({ multiple: false });
    if (!selection || Array.isArray(selection)) {
      return;
    }
    onPreviewPathChange?.(selection);
  };

  if (!previewPath || isBrowser || isCanvas) {
    return (
      <PanelShell
        filePanelMode={filePanelMode}
        onFilePanelModeChange={onFilePanelModeChange}
        className="file-tree-panel file-preview-panel"
        headerClassName="git-panel-header file-preview-header"
        headerLeft={<FilePreviewTabBar paths={visiblePreviewTabs} activePath={previewPath} onPreviewPathChange={onPreviewPathChange} onPreviewTabClose={onPreviewTabClose} />}
      >
        <div className="file-preview-panel-body">
          {!previewPath ? <PreviewAddPanel onPickFile={handlePickPreviewFile} onOpenBrowser={() => onPreviewPathChange?.("browser:")} onSideChat={onPreviewSideChat} onTerminal={onPreviewTerminal} onOpenCanvas={() => onPreviewPathChange?.(CANVAS_PREVIEW_PATH)} /> : null}
          {isBrowser ? <BrowersPreviewPanel previewPath={previewPath} isPanelVisible={isPanelVisible} onPreviewPathChange={onPreviewPathChange} /> : null}
          {isCanvas ? <CanvasPreviewPanel workspacePath={workspacePath} isPanelVisible={isPanelVisible} /> : null}
        </div>
      </PanelShell>
    );
  }

  return <FilePreviewPanel {...props} />;
}
