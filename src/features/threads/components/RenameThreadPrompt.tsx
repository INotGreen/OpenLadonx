import { useEffect, useRef } from "react";
import { ModalShell } from "../../design-system/components/modal/ModalShell";
import { useI18nSafe } from "@/hooks/useI18nSafe";

type RenameThreadPromptProps = {
  currentName: string;
  name: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RenameThreadPrompt({
  currentName,
  name,
  onChange,
  onCancel,
  onConfirm,
}: RenameThreadPromptProps) {
  const { t } = useI18nSafe();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <ModalShell
      className="worktree-modal"
      onBackdropClick={onCancel}
      ariaLabel={String(t("thread.renameThread.title"))}
    >
      <div className="ds-modal-title worktree-modal-title">{String(t("thread.renameThread.title"))}</div>
      <div className="ds-modal-subtitle worktree-modal-subtitle">
        {String(t("thread.renameThread.currentName", { name: currentName }))}
      </div>
      <label className="ds-modal-label worktree-modal-label" htmlFor="thread-rename">
        {String(t("thread.renameThread.newName"))}
      </label>
      <input
        id="thread-rename"
        ref={inputRef}
        className="ds-modal-input worktree-modal-input"
        value={name}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            onConfirm();
          }
        }}
      />
      <div className="ds-modal-actions worktree-modal-actions">
        <button
          className="ghost ds-modal-button worktree-modal-button"
          onClick={onCancel}
          type="button"
        >
          {String(t("common.cancel"))}
        </button>
        <button
          className="primary ds-modal-button worktree-modal-button"
          onClick={onConfirm}
          type="button"
          disabled={name.trim().length === 0}
        >
          {String(t("common.rename"))}
        </button>
      </div>
    </ModalShell>
  );
}
