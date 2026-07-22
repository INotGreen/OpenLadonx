let activeAttachmentDragPaths: string[] = [];
let isAttachmentDragHoveringComposer = false;
let clearAttachmentDragSessionTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingAttachmentDragSessionTimer() {
  if (clearAttachmentDragSessionTimer == null) {
    return;
  }
  clearTimeout(clearAttachmentDragSessionTimer);
  clearAttachmentDragSessionTimer = null;
}

export function beginAttachmentDragSession(paths: string[]) {
  clearPendingAttachmentDragSessionTimer();
  activeAttachmentDragPaths = Array.from(
    new Set(paths.map((path) => path.trim()).filter(Boolean)),
  );
  isAttachmentDragHoveringComposer = false;
}

export function getAttachmentDragSessionPaths() {
  return activeAttachmentDragPaths;
}

export function clearAttachmentDragSession() {
  clearPendingAttachmentDragSessionTimer();
  activeAttachmentDragPaths = [];
  isAttachmentDragHoveringComposer = false;
}

export function scheduleAttachmentDragSessionClear(delayMs = 350) {
  clearPendingAttachmentDragSessionTimer();
  clearAttachmentDragSessionTimer = setTimeout(() => {
    clearAttachmentDragSessionTimer = null;
    activeAttachmentDragPaths = [];
    isAttachmentDragHoveringComposer = false;
  }, delayMs);
}

export function setAttachmentDragHoveringComposer(value: boolean) {
  isAttachmentDragHoveringComposer = value;
}

export function getAttachmentDragHoveringComposer() {
  return isAttachmentDragHoveringComposer;
}
