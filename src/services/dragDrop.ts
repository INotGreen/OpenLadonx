import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type DragDropPayload =
  | {
      type: "enter" | "drop";
      position: { x: number; y: number };
      paths: string[];
    }
  | {
      type: "over";
      position: { x: number; y: number };
    }
  | {
      type: "leave";
    };

export type DragDropEvent = {
  payload: DragDropPayload;
};

type Listener = (event: DragDropEvent) => void;

type SubscriptionOptions = {
  onError?: (error: unknown) => void;
};

let unlisten: (() => void) | null = null;
let listenPromise: Promise<() => void> | null = null;
const listeners = new Set<Listener>();

function dispatchDragDropEvent(event: DragDropEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("[drag-drop] listener failed", error);
    }
  }
}

function start(options?: SubscriptionOptions) {
  if (unlisten || listenPromise) {
    return;
  }
  const attachListener = async () => {
    try {
      return await getCurrentWebview().onDragDropEvent((event) => {
        dispatchDragDropEvent(event as DragDropEvent);
      });
    } catch {
      return getCurrentWindow().onDragDropEvent((event) => {
        dispatchDragDropEvent(event as DragDropEvent);
      });
    }
  };
  listenPromise = attachListener();
  listenPromise
    .then((handler) => {
      listenPromise = null;
      if (listeners.size === 0) {
        handler();
        return;
      }
      unlisten = handler;
    })
    .catch((error) => {
      listenPromise = null;
      options?.onError?.(error);
    });
}

function stop() {
  if (!unlisten) {
    return;
  }
  try {
    unlisten();
  } catch {
    // Ignore double-unlisten when tearing down.
  }
  unlisten = null;
}

export function subscribeWindowDragDrop(
  onEvent: Listener,
  options?: SubscriptionOptions,
) {
  listeners.add(onEvent);
  start(options);
  return () => {
    listeners.delete(onEvent);
    if (listeners.size === 0) {
      stop();
    }
  };
}
