import Check from "lucide-react/dist/esm/icons/check";
import type { SuccessToast } from "../../../services/toasts";
import {
  ToastBody,
  ToastCard,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "../../design-system/components/toast/ToastPrimitives";

type SuccessToastsProps = {
  toasts: SuccessToast[];
  onDismiss: (id: string) => void;
};

export function SuccessToasts({ toasts, onDismiss }: SuccessToastsProps) {
  if (!toasts.length) {
    return null;
  }

  return (
    <ToastViewport className="success-toasts" role="region" ariaLive="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} className="success-toast" role="status">
          <ToastHeader className="success-toast-header">
            <div className="success-toast-title-wrap">
              <span className="success-toast-icon" aria-hidden>
                <Check size={14} />
              </span>
              <ToastTitle className="success-toast-title">{toast.title}</ToastTitle>
            </div>
            <button
              type="button"
              className="ghost success-toast-dismiss"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss success message"
              title="Dismiss"
            >
              ×
            </button>
          </ToastHeader>
          <ToastBody className="success-toast-body">{toast.message}</ToastBody>
        </ToastCard>
      ))}
    </ToastViewport>
  );
}
