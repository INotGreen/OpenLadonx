import { useEffect, type CSSProperties, type RefObject } from "react";
import type { AutocompleteItem } from "../hooks/useComposerAutocomplete";
import Brain from "lucide-react/dist/esm/icons/brain";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitFork from "lucide-react/dist/esm/icons/git-fork";
import Info from "lucide-react/dist/esm/icons/info";
import Package from "lucide-react/dist/esm/icons/package";
import PlusCircle from "lucide-react/dist/esm/icons/plus-circle";
import Plug from "lucide-react/dist/esm/icons/plug";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import { PopoverSurface } from "../../design-system/components/popover/PopoverPrimitives";
import { ReviewInlinePrompt } from "./ReviewInlinePrompt";
import type { ReviewPromptState, ReviewPromptStep } from "../../threads/hooks/useReviewPrompt";
import { getFileTypeIconUrl } from "../../../utils/fileTypeIcons";
import { useI18nSafe } from "../../../hooks/useI18nSafe";

/**
 * Composer 建议弹出框组件属性
 */
type ComposerSuggestionsPopoverProps = {
  /** 高亮索引 */
  highlightIndex: number;
  /** 高亮的分支索引 */
  highlightedBranchIndex?: number;
  /** 高亮的提交索引 */
  highlightedCommitIndex?: number;
  /** 高亮的预设索引 */
  highlightedPresetIndex?: number;
  /** 高亮索引回调 */
  onHighlightIndex: (index: number) => void;
  /** 选择审查提示预设回调 */
  onReviewPromptChoosePreset?: (
    preset: Exclude<ReviewPromptStep, "preset"> | "uncommitted",
  ) => void;
  /** 关闭审查提示回调 */
  onReviewPromptClose?: () => void;
  /** 确认分支回调 */
  onReviewPromptConfirmBranch?: () => Promise<void>;
  /** 确认提交回调 */
  onReviewPromptConfirmCommit?: () => Promise<void>;
  /** 确认自定义指令回调 */
  onReviewPromptConfirmCustom?: () => Promise<void>;
  /** 高亮分支回调 */
  onReviewPromptHighlightBranch?: (index: number) => void;
  /** 高亮提交回调 */
  onReviewPromptHighlightCommit?: (index: number) => void;
  /** 高亮预设回调 */
  onReviewPromptHighlightPreset?: (index: number) => void;
  /** 选择分支回调 */
  onReviewPromptSelectBranch?: (value: string) => void;
  /** 按索引选择分支回调 */
  onReviewPromptSelectBranchAtIndex?: (index: number) => void;
  /** 选择提交回调 */
  onReviewPromptSelectCommit?: (sha: string, title: string) => void;
  /** 按索引选择提交回调 */
  onReviewPromptSelectCommitAtIndex?: (index: number) => void;
  /** 显示预设回调 */
  onReviewPromptShowPreset?: () => void;
  /** 更新自定义指令回调 */
  onReviewPromptUpdateCustomInstructions?: (value: string) => void;
  /** 选择建议回调 */
  onSelectSuggestion: (item: AutocompleteItem) => void;
  /** 审查提示状态 */
  reviewPrompt?: ReviewPromptState;
  /** 建议列表引用 */
  suggestionListRef: RefObject<HTMLDivElement | null>;
  /** 建议项引用数组 */
  suggestionRefs: RefObject<Array<HTMLButtonElement | null>>;
  /** 建议列表 */
  suggestions: AutocompleteItem[];
  /** 是否打开建议 */
  suggestionsOpen: boolean;
  /** 建议样式 */
  suggestionsStyle?: CSSProperties;
};

/**
 * 判断是否为文件建议项
 * @param item - 建议项
 * @returns 是否为文件建议
 */
const isFileSuggestion = (item: AutocompleteItem) => item.group === "Files";

/**
 * 获取建议项图标
 * @param item - 建议项
 * @returns 图标组件
 */
const suggestionIcon = (item: AutocompleteItem) => {
  if (isFileSuggestion(item)) {
    return FileText;
  }
  if (item.id.startsWith("skill:")) {
    return Package;
  }
  if (item.id.startsWith("plugin:")) {
    return Package;
  }
  if (item.id.startsWith("app:")) {
    return Plug;
  }
  if (item.id === "review") {
    return Brain;
  }
  if (item.id === "fork") {
    return GitFork;
  }
  if (item.id === "mcp" || item.id === "apps") {
    return Plug;
  }
  if (item.id === "new") {
    return PlusCircle;
  }
  if (item.id === "resume") {
    return RotateCcw;
  }
  if (item.id === "status") {
    return Info;
  }
  if (item.id.startsWith("prompt:")) {
    return ScrollText;
  }
  return Wrench;
};

const fileTitle = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
};

export function ComposerSuggestionsPopover({
  highlightIndex,
  highlightedBranchIndex,
  highlightedCommitIndex,
  highlightedPresetIndex,
  onHighlightIndex,
  onReviewPromptChoosePreset,
  onReviewPromptClose,
  onReviewPromptConfirmBranch,
  onReviewPromptConfirmCommit,
  onReviewPromptConfirmCustom,
  onReviewPromptHighlightBranch,
  onReviewPromptHighlightCommit,
  onReviewPromptHighlightPreset,
  onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex,
  onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex,
  onReviewPromptShowPreset,
  onReviewPromptUpdateCustomInstructions,
  onSelectSuggestion,
  reviewPrompt,
  suggestionListRef,
  suggestionRefs,
  suggestions,
  suggestionsOpen,
  suggestionsStyle,
}: ComposerSuggestionsPopoverProps) {
  const reviewPromptOpen = Boolean(reviewPrompt);
  const suggestionsCount = suggestions.length;
  const { t } = useI18nSafe();

  useEffect(() => {
    if (!suggestionsOpen || reviewPromptOpen || suggestionsCount === 0) {
      return;
    }
    const list = suggestionListRef.current;
    const item = suggestionRefs.current[highlightIndex];
    if (!list || !item) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < listRect.top) {
      item.scrollIntoView({ block: "nearest" });
      return;
    }
    if (itemRect.bottom > listRect.bottom) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [
    highlightIndex,
    reviewPromptOpen,
    suggestionListRef,
    suggestionRefs,
    suggestionsCount,
    suggestionsOpen,
  ]);

  if (!suggestionsOpen) {
    return null;
  }

  return (
    <PopoverSurface
      className={`composer-suggestions${reviewPromptOpen ? " review-inline-suggestions" : ""}`}
      role="listbox"
      ref={suggestionListRef}
      style={suggestionsStyle}
    >
      {reviewPromptOpen &&
      reviewPrompt &&
      onReviewPromptClose &&
      onReviewPromptShowPreset &&
      onReviewPromptChoosePreset &&
      highlightedPresetIndex !== undefined &&
      onReviewPromptHighlightPreset &&
      highlightedBranchIndex !== undefined &&
      onReviewPromptHighlightBranch &&
      highlightedCommitIndex !== undefined &&
      onReviewPromptHighlightCommit &&
      onReviewPromptSelectBranch &&
      onReviewPromptSelectBranchAtIndex &&
      onReviewPromptConfirmBranch &&
      onReviewPromptSelectCommit &&
      onReviewPromptSelectCommitAtIndex &&
      onReviewPromptConfirmCommit &&
      onReviewPromptUpdateCustomInstructions &&
      onReviewPromptConfirmCustom ? (
        <ReviewInlinePrompt
          reviewPrompt={reviewPrompt}
          onClose={onReviewPromptClose}
          onShowPreset={onReviewPromptShowPreset}
          onChoosePreset={onReviewPromptChoosePreset}
          highlightedPresetIndex={highlightedPresetIndex}
          onHighlightPreset={onReviewPromptHighlightPreset}
          highlightedBranchIndex={highlightedBranchIndex}
          onHighlightBranch={onReviewPromptHighlightBranch}
          highlightedCommitIndex={highlightedCommitIndex}
          onHighlightCommit={onReviewPromptHighlightCommit}
          onSelectBranch={onReviewPromptSelectBranch}
          onSelectBranchAtIndex={onReviewPromptSelectBranchAtIndex}
          onConfirmBranch={onReviewPromptConfirmBranch}
          onSelectCommit={onReviewPromptSelectCommit}
          onSelectCommitAtIndex={onReviewPromptSelectCommitAtIndex}
          onConfirmCommit={onReviewPromptConfirmCommit}
          onUpdateCustomInstructions={onReviewPromptUpdateCustomInstructions}
          onConfirmCustom={onReviewPromptConfirmCustom}
        />
      ) : (
        suggestions.map((item, index) => {
          const prevGroup = suggestions[index - 1]?.group;
          const showGroup = Boolean(item.group && item.group !== prevGroup);
          const Icon = suggestionIcon(item);
          const fileSuggestion = isFileSuggestion(item);
          const skillSuggestion =
            item.id.startsWith("skill:") || item.id.startsWith("plugin:");
          const title = fileSuggestion
            ? fileTitle(item.label)
            : (item.displayTitle ?? item.label);
          const description = fileSuggestion
            ? item.label
            : skillSuggestion
              ? item.description ?? item.skillPath ?? item.pluginPath
              : item.description;
          const suggestionIconUrl = fileSuggestion
            ? getFileTypeIconUrl(item.label)
            : item.id.startsWith("plugin:")
              ? item.iconDataUrl ?? null
              : null;

          return (
            <div key={item.id}>
              {showGroup && (
                <div className="composer-suggestion-section">
                  {item.group ? t(`composer.suggestionGroups.${item.group}`, { defaultValue: item.group }) : item.group}
                </div>
              )}
              <button
                type="button"
                className={`composer-suggestion${
                  index === highlightIndex ? " is-active" : ""
                }${skillSuggestion ? " composer-suggestion--skill" : ""}${
                  fileSuggestion ? " composer-suggestion--file" : ""
                }`}
                role="option"
                aria-selected={index === highlightIndex}
                ref={(node) => {
                  suggestionRefs.current[index] = node;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelectSuggestion(item)}
                onMouseEnter={() => onHighlightIndex(index)}
              >
                <span className="composer-suggestion-row">
                  <span className="composer-suggestion-icon" aria-hidden>
                    {suggestionIconUrl ? (
                      <img
                        className="composer-suggestion-icon-image"
                        src={suggestionIconUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <Icon size={14} />
                    )}
                  </span>
                  <span className="composer-suggestion-content">
                    {skillSuggestion || fileSuggestion ? (
                      <span className="composer-suggestion-inline">
                        <span className="composer-suggestion-title">{title}</span>
                        {description && (
                          <span className="composer-suggestion-description composer-suggestion-description--skill">
                            {description}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="composer-suggestion-inline">
                        <span className="composer-suggestion-title">{title}</span>
                        {description && (
                          <span className="composer-suggestion-description">
                            {description}
                          </span>
                        )}
                      </span>
                    )}
                    {!fileSuggestion && item.hint && (
                      <span className="composer-suggestion-description">{item.hint}</span>
                    )}
                  </span>
                </span>
              </button>
            </div>
          );
        })
      )}
    </PopoverSurface>
  );
}
