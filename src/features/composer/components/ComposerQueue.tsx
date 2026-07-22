import GripVertical from "lucide-react/dist/esm/icons/grip-vertical";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Upload from "lucide-react/dist/esm/icons/upload";
import type { QueuedMessage } from "../../../types";

type ComposerQueueProps = {
  queuedMessages: QueuedMessage[];
  pausedReason?: string | null;
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
  onSendQueuedNow?: (item: QueuedMessage) => void | Promise<void>;
};

export function ComposerQueue({
  queuedMessages,
  pausedReason = null,
  onEditQueued,
  onDeleteQueued,
  onSendQueuedNow,
}: ComposerQueueProps) {
  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="composer-queue">
      <div className="composer-queue-list">
        {queuedMessages.map((item) => (
          <div key={item.id} className="composer-queue-item">
            <div className="composer-queue-grip" aria-hidden>
              <GripVertical size={16} strokeWidth={1.8} />
            </div>
            <div className="composer-queue-content">
              {/* <span className="composer-queue-index">{index + 1}</span> */}
              <span className="composer-queue-text">
                {item.text ||
                  (item.images?.length
                    ? item.images.length === 1
                      ? "Image"
                      : "Images"
                    : "")}
                {item.images?.length
                  ? ` · ${item.images.length} image${item.images.length === 1 ? "" : "s"}`
                  : ""}
              </span>
            </div>
            <div className="composer-queue-actions">
              <button
                type="button"
                className="composer-queue-action composer-queue-action--primary"
                onClick={() => {
                  void onSendQueuedNow?.(item);
                }}
              >
                <Upload size={14} strokeWidth={1.8} aria-hidden />
                <span>立即</span>
              </button>
              <button
                type="button"
                className="composer-queue-action"
                onClick={() => onEditQueued?.(item)}
                aria-label="Edit queued item"
                title="Edit"
              >
                <Pencil size={14} strokeWidth={1.8} aria-hidden />
              </button>
              <button
                type="button"
                className="composer-queue-action"
                onClick={() => onDeleteQueued?.(item.id)}
                aria-label="Delete queued item"
                title="Delete"
              >
                <Trash2 size={14} strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
      {pausedReason ? (
        <div className="composer-queue-hint">{pausedReason}</div>
      ) : null}
    </div>
  );
}
