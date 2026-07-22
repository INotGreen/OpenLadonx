import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Webview } from "@tauri-apps/api/webview";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw";

const MATERIAL_GOOGLE_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg width="800px" height="800px" viewBox="-0.82 0 437.46 437.46" xmlns="http://www.w3.org/2000/svg"><path d="M217.341.039s128.478-5.783 196.57 123.337H206.416s-39.188-1.289-72.593 46.255c-9.634 19.916-19.91 40.473-8.349 80.937C108.773 222.309 36.823 97.04 36.823 97.04S87.578 5.176 217.341.039z" fill="#c6352e"/><path d="M407.223 327.871s-59.247 114.143-205.118 108.533c17.995-31.148 103.772-179.682 103.772-179.682s20.709-33.289-3.744-85.991c-12.431-18.305-25.09-37.486-65.919-47.713 32.836-.326 177.285.021 177.285.021s54.168 89.891-6.276 204.832z" fill="#f4d911"/><path d="M28.373 328.738s-69.224-108.395 8.58-231.908c17.979 31.16 103.71 179.72 103.71 179.72s18.469 34.578 76.341 39.756c22.061-1.609 45.007-2.982 74.279-33.223-16.139 28.594-88.673 153.521-88.673 153.521S97.681 438.56 28.373 328.738z" fill="#81b354"/><path d="M202.105 437.46l29.187-121.793s32.092-2.504 58.982-32.017c-16.693 29.365-88.169 153.81-88.169 153.81z" fill="#7baa50"/><path d="M119.59 220.093c0-53.69 43.52-97.215 97.215-97.215 53.69 0 97.214 43.524 97.214 97.215 0 53.693-43.522 97.219-97.214 97.219-53.695 0-97.215-43.525-97.215-97.219z" fill="#ffffff"/><linearGradient id="a" gradientUnits="userSpaceOnUse" x1="-829.128" y1="1417.339" x2="-829.128" y2="1261.441" gradientTransform="matrix(1 0 0 -1 1045.93 1557.636)"><stop offset="0" stop-color="#a2c0e6"/><stop offset="1" stop-color="#406cb1"/></linearGradient><path d="M135.86 220.093c0-44.702 36.238-80.941 80.945-80.941 44.698 0 80.94 36.239 80.94 80.941 0 44.703-36.242 80.945-80.94 80.945-44.707.001-80.945-36.244-80.945-80.945z" fill="url(#a)"/><path d="M413.5 123.039l-120.183 35.237s-18.123-26.596-57.104-35.258c33.776-.115 177.287.021 177.287.021z" fill="#e7ce12"/><path d="M123.137 246.197c-16.89-29.25-86.31-149.16-86.31-149.16l89.029 88.07s-9.149 18.82-5.68 45.7l2.961 15.39z" fill="#bc332c"/></svg>`,
)}`;

const BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX = "file-preview-browser-webview";

function browserUrlFromPath(path: string | null) {
  return path?.startsWith("browser:") ? path.slice("browser:".length) : "";
}

function stripUrlProtocol(value: string) {
  return value.replace(/^https?:\/\//i, "");
}

function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return "";
  }
  const withProtocol = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname === "/" && !url.search && !url.hash) {
      return url.origin;
    }
    return url.toString();
  } catch {
    return "";
  }
}

type BrowserPreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function browserPreviewBounds(host: HTMLElement): BrowserPreviewBounds {
  const rect = host.getBoundingClientRect();
  return { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

function browserPreviewHostVisible(host: HTMLElement) {
  if (!host.isConnected) {
    return false;
  }
  const rect = host.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1 || host.closest(".app.right-panel-collapsed .right-panel")) {
    return false;
  }
  let current: HTMLElement | null = host;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

function browserPreviewErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function openBrowserPreview(label: string, url: string, bounds: BrowserPreviewBounds) {
  return invoke<void>("browser_preview_open", { label, url, ...bounds });
}

function setBrowserPreviewBounds(label: string, bounds: BrowserPreviewBounds) {
  void Webview.getByLabel(label).then((webview) => {
    if (!webview) {
      return;
    }
    return webview
      .setPosition(new LogicalPosition(bounds.x, bounds.y))
      .then(() => webview.setSize(new LogicalSize(bounds.width, bounds.height)))
      .then(() => webview.show());
  }).catch(() => {});
  return invoke<void>("browser_preview_set_bounds", { label, ...bounds });
}

function closeBrowserPreview(label: string) {
  void Webview.getByLabel(label).then((webview) => {
    if (!webview) {
      return;
    }
    return webview
      .hide()
      .then(() => webview.setPosition(new LogicalPosition(0, 0)))
      .then(() => webview.setSize(new LogicalSize(1, 1)))
      .then(() => webview.close());
  }).catch(() => {});
  void invoke<void>("browser_preview_hide", { label }).catch(() => {});
  return invoke<void>("browser_preview_close", { label });
}

function closeStaleBrowserPreviews(activeLabel: string) {
  void Webview.getAll().then((webviews) => {
    const closeTasks = webviews
      .filter((webview) => webview.label.startsWith(BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX) && webview.label !== activeLabel)
      .map((webview) =>
        webview
          .hide()
          .then(() => webview.setPosition(new LogicalPosition(0, 0)))
          .then(() => webview.setSize(new LogicalSize(1, 1)))
          .then(() => webview.close())
          .catch(() => undefined),
      );
    return Promise.all(closeTasks);
  }).catch(() => {});
  void invoke<void>("browser_preview_close", { label: BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX }).catch(() => {});
}

function closeBrowserPreviewSoon(label: string) {
  // Every close is scheduled via a timer (never fired immediately) so the
  // returned cleanup can cancel ALL of them. An immediate close can't be
  // canceled, so a subsequent effect run (React strict-mode remount,
  // hot-reload, or a url/isVisible change) that reuses the webview would still
  // get killed by the stale immediate close — which is exactly the
  // "created then immediately closed" bug.
  const firstTimer = window.setTimeout(() => {
    void closeBrowserPreview(label).catch(() => {});
  }, 0);
  const secondTimer = window.setTimeout(() => {
    void closeBrowserPreview(label).catch(() => {});
  }, 120);
  const thirdTimer = window.setTimeout(() => {
    void closeBrowserPreview(label).catch(() => {});
  }, 300);
  return () => {
    window.clearTimeout(firstTimer);
    window.clearTimeout(secondTimer);
    window.clearTimeout(thirdTimer);
  };
}

function TauriBrowserPreview({ url, isVisible, onOpenExternal }: { url: string; isVisible: boolean; onOpenExternal: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef(`${BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const readyRef = useRef(false);
  const openingRef = useRef(false);
  const openVersionRef = useRef(0);
  const pendingCloseRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const label = labelRef.current;
    return () => {
      readyRef.current = false;
      pendingCloseRef.current?.();
      pendingCloseRef.current = closeBrowserPreviewSoon(label);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const viewport = viewportRef.current;
    const label = labelRef.current;

    const hidePreview = () => {
      readyRef.current = false;
      openingRef.current = false;
      pendingCloseRef.current?.();
      pendingCloseRef.current = closeBrowserPreviewSoon(label);
    };

    if (!isVisible || !viewport) {
      hidePreview();
      return () => {
        cancelled = true;
      };
    }

    const openPreview = () => {
      if (cancelled || openingRef.current) {
        return;
      }
      openingRef.current = true;
      // Token so a stale openBrowserPreview().then() (from a React strict-mode
      // remount / hot-reload / url change) can't clobber the current run's
      // state.
      const version = (openVersionRef.current += 1);
      // Optimistic: the backend creates AND shows the webview inside
      // openBrowserPreview, so clear the loading overlay right away instead of
      // waiting for the .then(). Waiting was leaving the dark "loading" overlay
      // stuck on screen (the black screen), because the .then() racing with
      // strict-mode remounts never stabilized readyRef.
      readyRef.current = true;
      pendingCloseRef.current?.();
      pendingCloseRef.current = null;
      setStatus("ready");
      setError(null);
      closeStaleBrowserPreviews(label);
      const bounds = browserPreviewBounds(viewport);
      void openBrowserPreview(label, url, bounds).then(() => {
        if (cancelled || version !== openVersionRef.current) {
          return;
        }
        openingRef.current = false;
        syncBoundsForNextFrames();
      }).catch((previewError) => {
        if (cancelled || version !== openVersionRef.current) {
          return;
        }
        openingRef.current = false;
        readyRef.current = false;
        setStatus("error");
        setError(browserPreviewErrorMessage(previewError));
      });
    };

    const syncBounds = () => {
      if (cancelled) {
        return;
      }
      if (!browserPreviewHostVisible(viewport)) {
        hidePreview();
        return;
      }
      if (readyRef.current) {
        const bounds = browserPreviewBounds(viewport);
        void setBrowserPreviewBounds(label, bounds).catch((boundsError) => {
          if (!cancelled) {
            setStatus("error");
            setError(browserPreviewErrorMessage(boundsError));
          }
        });
      } else {
        // Host is visible but the webview isn't open yet — open it now. This
        // covers the case where the right panel finished expanding AFTER this
        // effect first ran (host was 0-width during the grid transition).
        openPreview();
      }
    };

    const scheduleSyncBounds = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(syncBounds);
    };

    const syncBoundsForNextFrames = () => {
      scheduleSyncBounds();
      window.setTimeout(scheduleSyncBounds, 40);
      window.setTimeout(scheduleSyncBounds, 120);
      window.setTimeout(scheduleSyncBounds, 240);
    };

    // Always set up observers so the webview opens the moment the host becomes
    // visible (e.g. after the right-panel expand transition completes).
    resizeObserver = new ResizeObserver(scheduleSyncBounds);
    resizeObserver.observe(viewport);

    const appElement = viewport.closest(".app");
    const rightPanel = viewport.closest(".right-panel");
    mutationObserver = new MutationObserver(scheduleSyncBounds);
    mutationObserver.observe(document.documentElement, { attributeFilter: ["class", "style", "hidden"], attributes: true });
    mutationObserver.observe(document.body, { attributeFilter: ["class", "style", "hidden"], attributes: true });
    if (appElement) {
      mutationObserver.observe(appElement, { attributeFilter: ["class", "style", "hidden"], attributes: true });
    }
    if (rightPanel) {
      mutationObserver.observe(rightPanel, { attributeFilter: ["class", "style", "hidden"], attributes: true });
    }
    window.addEventListener("resize", scheduleSyncBounds);
    window.addEventListener("scroll", scheduleSyncBounds, true);
    window.addEventListener("transitionrun", scheduleSyncBounds, true);
    window.addEventListener("transitionend", syncBoundsForNextFrames, true);
    window.visualViewport?.addEventListener("resize", scheduleSyncBounds);
    window.visualViewport?.addEventListener("scroll", scheduleSyncBounds);

    // Initial attempt: open now if the host is already visible, otherwise the
    // observers fire when it becomes visible.
    scheduleSyncBounds();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleSyncBounds);
      window.removeEventListener("scroll", scheduleSyncBounds, true);
      window.removeEventListener("transitionrun", scheduleSyncBounds, true);
      window.removeEventListener("transitionend", syncBoundsForNextFrames, true);
      window.visualViewport?.removeEventListener("resize", scheduleSyncBounds);
      window.visualViewport?.removeEventListener("scroll", scheduleSyncBounds);
      hidePreview();
    };
  }, [isVisible, url]);

  return (
    <div className="file-preview-browser-native" ref={viewportRef}>
      <div className="file-preview-browser-webview-host" aria-hidden />
      {status !== "ready" ? (
        <div className="file-preview-browser-native-overlay">
          <img className="file-preview-browser-external-icon" src={MATERIAL_GOOGLE_ICON_URL} alt="" aria-hidden />
          <div className="file-preview-browser-external-title">{status === "loading" ? "Loading website..." : "WebView preview failed."}</div>
          {error ? <div className="file-preview-browser-external-url">{error}</div> : null}
          <button type="button" onClick={onOpenExternal}>
            <ExternalLink size={14} aria-hidden />
            Open website
          </button>
        </div>
      ) : null}
    </div>
  );
}

type BrowersPreviewPanelProps = {
  previewPath: string | null;
  isPanelVisible?: boolean;
  onPreviewPathChange?: (path: string | null) => void;
};

export function BrowersPreviewPanel({ previewPath, isPanelVisible = true, onPreviewPathChange }: BrowersPreviewPanelProps) {
  const browserUrl = normalizeBrowserUrl(browserUrlFromPath(previewPath));
  const [browserUrlInput, setBrowserUrlInput] = useState(stripUrlProtocol(browserUrl));
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setBrowserUrlInput(stripUrlProtocol(browserUrl));
  }, [browserUrl]);

  const commitBrowserUrl = () => {
    const nextUrl = normalizeBrowserUrl(browserUrlInput);
    if (nextUrl) {
      onPreviewPathChange?.(`browser:${nextUrl}`);
    }
  };

  const handleBrowserUrlSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitBrowserUrl();
  };

  const handleBrowserUrlEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitBrowserUrl();
    }
  };

  const handleBrowserUrlBlur = () => {
    setBrowserUrlInput((current) => stripUrlProtocol(current.trim()));
  };

  const handleBrowserReload = () => {
    setReloadKey((key) => key + 1);
  };

  return (
    <div className="file-preview-browser">
      <form className="file-preview-browser-bar" onSubmit={handleBrowserUrlSubmit}>
        <img className="file-preview-browser-bar-icon" src={MATERIAL_GOOGLE_ICON_URL} alt="" aria-hidden />
        <input type="text" inputMode="url" value={browserUrlInput} onBlur={handleBrowserUrlBlur} onChange={(event) => setBrowserUrlInput(event.target.value)} onKeyDown={handleBrowserUrlEnter} placeholder="example.com" aria-label="Website URL" />
        <button type="button" className="file-preview-browser-reload" onClick={handleBrowserReload} disabled={!browserUrl} aria-label="Reload website" title="Reload website">
          <RotateCw size={14} aria-hidden />
        </button>
        {browserUrl ? (
          <button type="button" onClick={() => void openUrl(browserUrl)}>
            Open
          </button>
        ) : null}
      </form>
      {browserUrl ? isPanelVisible ? <TauriBrowserPreview key={reloadKey} url={browserUrl} isVisible={isPanelVisible} onOpenExternal={() => void openUrl(browserUrl)} /> : null : <div className="file-preview-browser-empty">Enter a URL to open.</div>}
    </div>
  );
}
