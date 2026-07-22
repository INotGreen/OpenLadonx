import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type { PostUpdateNoticeState, UpdateState } from "../hooks/useUpdater";
import {
  ToastActions,
  ToastBody,
  ToastCard,
  ToastError,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "../../design-system/components/toast/ToastPrimitives";

type UpdateToastProps = {
  state: UpdateState;
  onUpdate: () => void;
  onDismiss: () => void;
  postUpdateNotice?: PostUpdateNoticeState;
  onDismissPostUpdateNotice?: () => void;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function UpdateToast({
  state,
  onUpdate,
  onDismiss,
  postUpdateNotice = null,
  onDismissPostUpdateNotice,
}: UpdateToastProps) {
  const { t } = useI18nSafe();

  if (postUpdateNotice) {
    return (
      <ToastViewport className="update-toasts" role="region" ariaLive="polite">
        <ToastCard className="update-toast" role="status">
          <ToastHeader className="update-toast-header">
            <ToastTitle className="update-toast-title">{String(t("updateToast.whatsNew"))}</ToastTitle>
            <div className="update-toast-version">v{postUpdateNotice.version}</div>
          </ToastHeader>
          {postUpdateNotice.stage === "loading" ? (
            <ToastBody className="update-toast-body">
              {String(t("updateToast.updatedSuccessfully"))} {String(t("updateToast.loadingReleaseNotes"))}
            </ToastBody>
          ) : null}
          {postUpdateNotice.stage === "ready" ? (
            <>
              <ToastBody className="update-toast-body">
                {String(t("updateToast.updatedSuccessfully"))} {String(t("updateToast.hereIsWhatIsNew"))}
              </ToastBody>
              <div className="update-toast-notes" role="document">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => {
                      if (!href) {
                        return <span>{children}</span>;
                      }
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            event.preventDefault();
                            void openUrl(href);
                          }}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {postUpdateNotice.body}
                </ReactMarkdown>
              </div>
            </>
          ) : null}
          {postUpdateNotice.stage === "fallback" ? (
            <ToastBody className="update-toast-body">
              {String(t("updateToast.updatedToVersion", { version: postUpdateNotice.version }))} {String(t("updateToast.releaseNotesCouldNotBeLoaded"))}
            </ToastBody>
          ) : null}
          <ToastActions className="update-toast-actions">
            {postUpdateNotice.stage !== "loading" ? (
              <button
                className="primary"
                onClick={() => {
                  void openUrl(postUpdateNotice.htmlUrl);
                }}
              >
                {String(t("updateToast.viewOnGitHub"))}
              </button>
            ) : null}
            <button
              className="secondary"
              onClick={onDismissPostUpdateNotice ?? onDismiss}
            >
              {String(t("updateToast.dismiss"))}
            </button>
          </ToastActions>
        </ToastCard>
      </ToastViewport>
    );
  }

  if (state.stage === "idle" || state.stage === "latest") {
    return null;
  }

  const totalBytes = state.progress?.totalBytes;
  const downloadedBytes = state.progress?.downloadedBytes ?? 0;
  const percent =
    totalBytes && totalBytes > 0
      ? Math.min(100, (downloadedBytes / totalBytes) * 100)
      : null;

  return (
    <ToastViewport className="update-toasts" role="region" ariaLive="polite">
      <ToastCard className="update-toast" role="status">
        <ToastHeader className="update-toast-header">
          <ToastTitle className="update-toast-title">{String(t("updateToast.updateTitle"))}</ToastTitle>
          {state.version ? (
            <div className="update-toast-version">v{state.version}</div>
          ) : null}
        </ToastHeader>
        {state.stage === "checking" && (
          <ToastBody className="update-toast-body">
            {String(t("updateToast.checkingForUpdates"))}
          </ToastBody>
        )}
        {state.stage === "available" && (
          <>
            <ToastBody className="update-toast-body">
              {String(t("updateToast.availableDownloading"))}
            </ToastBody>
            <ToastActions className="update-toast-actions">
              <button className="secondary" onClick={onDismiss}>
                {String(t("updateToast.dismiss"))}
              </button>
            </ToastActions>
          </>
        )}
        {state.stage === "downloaded" && (
          <>
            <ToastBody className="update-toast-body">
              {String(t("updateToast.downloadedRestartPrompt"))}
            </ToastBody>
            <ToastActions className="update-toast-actions">
              <button className="secondary" onClick={onDismiss}>
                {String(t("updateToast.later"))}
              </button>
              <button className="primary" onClick={onUpdate}>
                {String(t("updateToast.restartNow"))}
              </button>
            </ToastActions>
          </>
        )}
        {state.stage === "downloading" && (
          <>
            <ToastBody className="update-toast-body">
              {String(t("updateToast.downloadingUpdate"))}
            </ToastBody>
            <div className="update-toast-progress">
              <div className="update-toast-progress-bar">
                <span
                  className="update-toast-progress-fill"
                  style={{ width: percent ? `${percent}%` : "24%" }}
                />
              </div>
              <div className="update-toast-progress-meta">
                {totalBytes
                  ? String(t("updateToast.bytesOfTotal", { downloaded: formatBytes(downloadedBytes), total: formatBytes(totalBytes) }))
                  : String(t("updateToast.bytesDownloaded", { downloaded: formatBytes(downloadedBytes) }))}
              </div>
            </div>
            <ToastActions className="update-toast-actions">
              <button className="secondary" onClick={onDismiss}>
                {String(t("common.cancel"))}
              </button>
            </ToastActions>
          </>
        )}
        {state.stage === "installing" && (
          <ToastBody className="update-toast-body">
            {String(t("updateToast.restartingToInstall"))}
          </ToastBody>
        )}
        {state.stage === "restarting" && (
          <ToastBody className="update-toast-body">{String(t("updateToast.restarting"))}</ToastBody>
        )}
        {state.stage === "error" && (
          <>
            <ToastBody className="update-toast-body">{String(t("updateToast.updateFailed"))}</ToastBody>
            {state.error ? (
              <ToastError className="update-toast-error">{state.error}</ToastError>
            ) : null}
            <ToastActions className="update-toast-actions">
              <button className="secondary" onClick={onDismiss}>
                {String(t("updateToast.dismiss"))}
              </button>
              <button className="primary" onClick={onUpdate}>
                {String(t("common.retry"))}
              </button>
            </ToastActions>
          </>
        )}
      </ToastCard>
    </ToastViewport>
  );
}
