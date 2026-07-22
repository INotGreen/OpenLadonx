import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import { isMobilePlatform, isWindowsPlatform } from "./utils/platformPaths";
import { writeStartupLog } from "./services/tauri";
import "./i18n";

// React DevTools browser extension will automatically connect to this React app
// For standalone DevTools app, run: npm run react:devtools

type InspectorCodeInfo = {
  lineNumber: string;
  columnNumber: string;
  relativePath?: string;
  absolutePath?: string;
};

const sentryDsn =
  import.meta.env.VITE_SENTRY_DSN ??
  "https://8ab67175daed999e8c432a93d8f98e49@o4510750015094784.ingest.us.sentry.io/4510750016012288";

Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  release: __APP_VERSION__,
});

Sentry.metrics.count("app_open", 1, {
  attributes: {
    env: import.meta.env.MODE,
    platform: "macos",
  },
});

function disableMobileZoomGestures() {
  if (!isMobilePlatform() || typeof document === "undefined") {
    return;
  }
  const preventGesture = (event: Event) => event.preventDefault();
  const preventPinch = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  };

  document.addEventListener("gesturestart", preventGesture, { passive: false });
  document.addEventListener("gesturechange", preventGesture, { passive: false });
  document.addEventListener("gestureend", preventGesture, { passive: false });
  document.addEventListener("touchmove", preventPinch, { passive: false });
}

function syncMobileViewportHeight() {
  if (!isMobilePlatform() || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  let rafHandle = 0;

  const setViewportHeight = () => {
    const visualViewport = window.visualViewport;
    const viewportHeight = visualViewport
      ? visualViewport.height + visualViewport.offsetTop
      : window.innerHeight;
    const nextHeight = Math.round(viewportHeight);
    document.documentElement.style.setProperty("--app-height", `${nextHeight}px`);
  };

  const scheduleViewportHeight = () => {
    if (rafHandle) {
      return;
    }
    rafHandle = window.requestAnimationFrame(() => {
      rafHandle = 0;
      setViewportHeight();
    });
  };

  const setComposerFocusState = () => {
    const activeElement = document.activeElement;
    const isComposerTextareaFocused =
      activeElement instanceof HTMLTextAreaElement &&
      activeElement.closest(".composer") !== null;
    document.documentElement.dataset.mobileComposerFocus = isComposerTextareaFocused
      ? "true"
      : "false";
  };

  setViewportHeight();
  setComposerFocusState();
  window.addEventListener("resize", scheduleViewportHeight, { passive: true });
  window.addEventListener("orientationchange", scheduleViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleViewportHeight, { passive: true });
  document.addEventListener("focusin", setComposerFocusState);
  document.addEventListener("focusout", () => {
    requestAnimationFrame(setComposerFocusState);
  });
}

function ReactDevInspector({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState(false);
  const [devTools, setDevTools] = React.useState<{
    Inspector: React.ComponentType<{
      active?: boolean;
      children?: React.ReactNode;
      keys?: string[] | null;
      onActiveChange?: (active: boolean) => void;
      onInspectElement?: (params: {
        element: HTMLElement;
        codeInfo: InspectorCodeInfo;
      }) => void;
    }>;
    Crosshair: React.ComponentType<{
      "aria-hidden"?: boolean;
      className?: string;
      strokeWidth?: number;
    }>;
    gotoServerEditor: (
      codeInfo?: InspectorCodeInfo | { codeInfo: InspectorCodeInfo },
    ) => void;
  } | null>(null);

  React.useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    let mounted = true;

    void Promise.all([
      import("./styles/react-dev-inspector.css"),
      import("react-dev-inspector"),
      import("lucide-react/dist/esm/icons/crosshair"),
    ]).then(([, inspectorModule, crosshairModule]) => {
      if (mounted) {
        setDevTools({
          Inspector: inspectorModule.Inspector,
          Crosshair: crosshairModule.default,
          gotoServerEditor: inspectorModule.gotoServerEditor,
        });
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (!import.meta.env.DEV || !devTools) {
    return <>{children}</>;
  }

  const { Crosshair, Inspector, gotoServerEditor } = devTools;

  return (
    <>
      <Inspector
        active={active}
        onActiveChange={setActive}
        onInspectElement={({ codeInfo, element }) => {
          if (element.closest(".react-dev-inspector-dock")) {
            return;
          }
          gotoServerEditor(codeInfo);
        }}
      >
        {children}
      </Inspector>
      <div className="react-dev-inspector-dock" aria-label="React developer inspector">
        <span className="react-dev-inspector-brand" aria-hidden="true">
          R
        </span>
        <span className="react-dev-inspector-separator" aria-hidden="true" />
        <button
          type="button"
          className={`react-dev-inspector-toggle ds-tooltip-trigger ${
            active ? "is-active" : ""
          }`}
          aria-label={active ? "Stop component inspector" : "Start component inspector"}
          aria-pressed={active}
          data-tooltip={`${active ? "Stop inspector" : "Start inspector"} (${
            isWindowsPlatform() ? "Ctrl+Shift+C" : "⌃⇧⌘C"
          })`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setActive((current) => !current);
          }}
        >
          <Crosshair className="react-dev-inspector-icon" strokeWidth={2.4} aria-hidden />
        </button>
      </div>
    </>
  );
}

disableMobileZoomGestures();
syncMobileViewportHeight();
if (isWindowsPlatform() && typeof document !== "undefined") {
  document.documentElement.dataset.platform = "windows";
}

function logRendererError(kind: string, detail: string) {
  void writeStartupLog(`renderer:${kind}: ${detail}`).catch(() => {
    // Ignore startup log write failures while reporting renderer crashes.
  });
}

function installStorageGuard() {
  if (typeof window === "undefined" || typeof Storage === "undefined") {
    return;
  }

  const fallbackValues = new WeakMap<Storage, Map<string, string>>();
  const guardedFlag = "__ladonxStorageGuardInstalled";
  const prototype = Storage.prototype as Storage["prototype"] & {
    [guardedFlag]?: boolean;
  };

  if (prototype[guardedFlag]) {
    return;
  }

  const ensureFallback = (storage: Storage) => {
    let fallback = fallbackValues.get(storage);
    if (!fallback) {
      fallback = new Map<string, string>();
      fallbackValues.set(storage, fallback);
    }
    return fallback;
  };

  const originalGetItem = prototype.getItem;
  const originalSetItem = prototype.setItem;
  const originalRemoveItem = prototype.removeItem;
  const originalClear = prototype.clear;

  prototype.getItem = function getItem(this: Storage, key: string) {
    try {
      const value = originalGetItem.call(this, key);
      if (value !== null) {
        ensureFallback(this).set(key, value);
        return value;
      }
    } catch {
      // Fall back to in-memory storage when browser storage is unavailable.
    }
    return ensureFallback(this).get(key) ?? null;
  };

  prototype.setItem = function setItem(this: Storage, key: string, value: string) {
    try {
      originalSetItem.call(this, key, value);
    } catch {
      // Keep the app usable for this session when storage quota is exhausted.
    }
    ensureFallback(this).set(key, value);
  };

  prototype.removeItem = function removeItem(this: Storage, key: string) {
    try {
      originalRemoveItem.call(this, key);
    } catch {
      // Ignore storage write failures and clear the in-memory fallback.
    }
    ensureFallback(this).delete(key);
  };

  prototype.clear = function clear(this: Storage) {
    try {
      originalClear.call(this);
    } catch {
      // Ignore storage write failures and clear the in-memory fallback.
    }
    ensureFallback(this).clear();
  };

  prototype[guardedFlag] = true;
}

if (typeof window !== "undefined") {
  installStorageGuard();

  window.addEventListener("error", (event) => {
    const message =
      event.error instanceof Error
        ? `${event.error.name}: ${event.error.message}\n${event.error.stack ?? ""}`
        : event.message || "unknown window error";
    logRendererError("error", message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
        : typeof reason === "string"
          ? reason
          : JSON.stringify(reason);
    logRendererError("unhandledrejection", message);
  });
}

function RootFallback({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  React.useEffect(() => {
    logRendererError("boundary", message);
  }, [message]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f5f5f5",
        color: "#111",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 720 }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          LadonX encountered a renderer error
        </div>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message}
        </pre>
      </div>
    </div>
  );
}

logRendererError("boot", "React root render starting");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={({ error }) => <RootFallback error={error} />}>
      <ReactDevInspector>
        <App />
      </ReactDevInspector>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
