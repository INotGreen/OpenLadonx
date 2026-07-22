import { useCallback, useEffect, useRef, useState } from "react";
import type { SuccessToast } from "../../../services/toasts";
import { subscribeSuccessToasts } from "../../../services/toasts";

const DEFAULT_SUCCESS_TOAST_DURATION_MS = 2200;

export function useSuccessToasts() {
  const [toasts, setToasts] = useState<SuccessToast[]>([]);
  const timeoutByIdRef = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    const timeoutId = timeoutByIdRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutByIdRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const timeouts = timeoutByIdRef.current;
    const unsubscribe = subscribeSuccessToasts((toast) => {
      setToasts((prev) => [...prev, toast]);
      const durationMs = toast.durationMs ?? DEFAULT_SUCCESS_TOAST_DURATION_MS;
      const timeoutId = window.setTimeout(() => {
        dismissToast(toast.id);
      }, durationMs);
      timeouts.set(toast.id, timeoutId);
    });

    return () => {
      unsubscribe();
      for (const timeoutId of timeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      timeouts.clear();
    };
  }, [dismissToast]);

  return {
    successToasts: toasts,
    dismissSuccessToast: dismissToast,
  };
}
