//注释：用于在 Composer 中显示附件弹出菜单。

import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FilePlus from "lucide-react/dist/esm/icons/file-plus";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus";
import Target from "lucide-react/dist/esm/icons/target";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import Package from "lucide-react/dist/esm/icons/package";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import type { PluginOption } from "../../../types";
import { useI18nSafe } from "../../../hooks/useI18nSafe";
import { PopoverSurface } from "../../design-system/components/popover/PopoverPrimitives";

export type ComposerActionTag = "plan" | "goal";

type ComposerAttachPopoverProps = {
  open: boolean;
  plugins: PluginOption[];
  selectedActionTags: ComposerActionTag[];
  onAttachActionTag: (tag: ComposerActionTag) => void;
  onOpenTerminal: () => void;
  onAttachFiles: () => void;
  onAttachFolders: () => void;
  onAttachImages: () => void;
  onAttachPlugin: (plugin: PluginOption) => void;
};

export function ComposerAttachPopover({
  open,
  plugins,
  selectedActionTags,
  onAttachActionTag,
  onOpenTerminal,
  onAttachFiles,
  onAttachFolders,
  onAttachImages,
  onAttachPlugin,
}: ComposerAttachPopoverProps) {
  const { t } = useI18nSafe();
  if (!open) {
    return null;
  }

  return (
    <PopoverSurface
      className="composer-suggestions composer-attach-popover"
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="composer-suggestion-section">{t("composer.suggestionGroups.Actions")}</div>
      <button
        type="button"
        className="composer-suggestion composer-suggestion--skill composer-attach-suggestion"
        onClick={onAttachFiles}
      >
        <span className="composer-suggestion-row">
          <span className="composer-suggestion-icon" aria-hidden>
            <FilePlus size={16} strokeWidth={1.6} />
          </span>
          <span className="composer-suggestion-content">
            <span className="composer-suggestion-inline">
              <span className="composer-suggestion-title">文件</span>
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="composer-suggestion composer-suggestion--skill composer-attach-suggestion"
        onClick={onAttachFolders}
      >
        <span className="composer-suggestion-row">
          <span className="composer-suggestion-icon" aria-hidden>
            <FolderOpen size={16} strokeWidth={1.6} />
          </span>
          <span className="composer-suggestion-content">
            <span className="composer-suggestion-inline">
              <span className="composer-suggestion-title">文件夹</span>
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="composer-suggestion composer-suggestion--skill composer-attach-suggestion"
        onClick={onAttachImages}
      >
        <span className="composer-suggestion-row">
          <span className="composer-suggestion-icon" aria-hidden>
            <ImagePlus size={16} strokeWidth={1.6} />
          </span>
          <span className="composer-suggestion-content">
            <span className="composer-suggestion-inline">
              <span className="composer-suggestion-title">图片</span>
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="composer-suggestion composer-suggestion--skill composer-attach-suggestion"
        onClick={() => onAttachActionTag("plan")}
      >
        <span className="composer-suggestion-row">
          <span className="composer-suggestion-icon" aria-hidden>
            <ListTodo size={16} strokeWidth={1.6} />
          </span>
          <span className="composer-suggestion-content">
            <span className="composer-suggestion-inline">
              <span className="composer-suggestion-title">计划</span>
              {selectedActionTags.includes("plan") ? (
                <span className="composer-suggestion-description composer-suggestion-description--skill">
                  已添加
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="composer-suggestion composer-suggestion--skill composer-attach-suggestion"
        onClick={() => onAttachActionTag("goal")}
      >
        <span className="composer-suggestion-row">
          <span className="composer-suggestion-icon" aria-hidden>
            <Target size={16} strokeWidth={1.6} />
          </span>
          <span className="composer-suggestion-content">
            <span className="composer-suggestion-inline">
              <span className="composer-suggestion-title">目标</span>
              {selectedActionTags.includes("goal") ? (
                <span className="composer-suggestion-description composer-suggestion-description--skill">
                  已添加
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="composer-suggestion composer-suggestion--skill composer-attach-suggestion"
        onClick={onOpenTerminal}
      >
        <span className="composer-suggestion-row">
          <span className="composer-suggestion-icon" aria-hidden>
            <SquareTerminal size={16} strokeWidth={1.6} />
          </span>
          <span className="composer-suggestion-content">
            <span className="composer-suggestion-inline">
              <span className="composer-suggestion-title">打开终端</span>
            </span>
          </span>
        </span>
      </button>
      {plugins.length > 0 ? (
        <>
          <div className="composer-suggestion-section">{t("composer.suggestionGroups.Plugins")}</div>
          {plugins.map((plugin) => {
            const title = plugin.name.trim() || plugin.key;
            const description = plugin.description?.trim() || plugin.path.trim();
            return (
              <button
                key={plugin.key}
                type="button"
                className="composer-suggestion composer-suggestion--skill composer-attach-suggestion"
                onClick={() => onAttachPlugin(plugin)}
                title={plugin.path}
              >
                <span className="composer-suggestion-row">
                  <span
                    className="composer-suggestion-icon"
                    aria-hidden
                    style={plugin.brandColor ? { color: plugin.brandColor } : undefined}
                  >
                    {plugin.iconDataUrl ? (
                      <img
                        className="composer-suggestion-icon-image"
                        src={plugin.iconDataUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <Package size={16} strokeWidth={1.6} />
                    )}
                  </span>
                  <span className="composer-suggestion-content">
                    <span className="composer-suggestion-inline">
                      <span className="composer-suggestion-title">{title}</span>
                      {description ? (
                        <span className="composer-suggestion-description composer-suggestion-description--skill">
                          {description}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </>
      ) : null}
    </PopoverSurface>
  );
}
