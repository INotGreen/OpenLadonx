export type ErrorToast = {
  id: string;
  title: string;
  message: string;
  durationMs?: number;
};

export type ErrorToastInput = Omit<ErrorToast, "id"> & {
  id?: string;
};

export type SuccessToast = {
  id: string;
  title: string;
  message: string;
  durationMs?: number;
};

export type SuccessToastInput = Omit<SuccessToast, "id"> & {
  id?: string;
};

type ErrorToastListener = (toast: ErrorToast) => void;
type SuccessToastListener = (toast: SuccessToast) => void;

const errorToastListeners = new Set<ErrorToastListener>();
const successToastListeners = new Set<SuccessToastListener>();

function makeToastId() {
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function pushErrorToast(input: ErrorToastInput) {
  const toast: ErrorToast = {
    id: input.id ?? makeToastId(),
    title: input.title,
    message: input.message,
    durationMs: input.durationMs,
  };

  for (const listener of errorToastListeners) {
    try {
      listener(toast);
    } catch (error) {
      console.error("[toasts] error toast listener failed", error);
    }
  }

  return toast.id;
}

export function subscribeErrorToasts(listener: ErrorToastListener) {
  errorToastListeners.add(listener);
  return () => {
    errorToastListeners.delete(listener);
  };
}

export function pushSuccessToast(input: SuccessToastInput) {
  const toast: SuccessToast = {
    id: input.id ?? makeToastId(),
    title: input.title,
    message: input.message,
    durationMs: input.durationMs,
  };

  for (const listener of successToastListeners) {
    try {
      listener(toast);
    } catch (error) {
      console.error("[toasts] success toast listener failed", error);
    }
  }

  return toast.id;
}

export function subscribeSuccessToasts(listener: SuccessToastListener) {
  successToastListeners.add(listener);
  return () => {
    successToastListeners.delete(listener);
  };
}
