import { useCallback, useEffect, useRef, useState } from "react";
import {
  readClipboardFilePaths,
  readClipboardImagePath,
  saveClipboardImageDataUrl,
} from "../../../services/tauri";
import { subscribeWindowDragDrop } from "../../../services/dragDrop";
import {
  clearAttachmentDragSession,
  getAttachmentDragSessionPaths,
  setAttachmentDragHoveringComposer,
} from "../../../utils/attachmentDragSession";
import {
  decodeDroppedFileUri,
  extractPathsFromTransferData,
  isDragFileTransfer,
} from "../../../utils/fileDragTransfer";

function isAbsoluteClipboardPath(value: string) {
  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(value);
}

function extractPathsFromClipboard(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer) {
    return [];
  }
  const directPaths = extractPathsFromTransferData(dataTransfer);
  if (directPaths.length > 0) {
    return directPaths;
  }
  const plainText = dataTransfer.getData("text/plain");
  if (!plainText) {
    return [];
  }
  const lines = plainText
    .split("\0")
    .flatMap((part) => part.split(/\r?\n/))
    .map((value) => value.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const allArePaths = lines.every(
    (line) => isAbsoluteClipboardPath(line) || /^file:/i.test(line),
  );
  if (!allArePaths) {
    return [];
  }
  return Array.from(
    new Set(lines.map((value) => decodeDroppedFileUri(value)).filter(Boolean)),
  );
}

/**
 * 获取拖放位置
 * @param position - 原始位置
 * @returns 拖放位置
 */
function getDragPosition(position: { x: number; y: number }) {
  return position;
}

/**
 * 规范化拖放位置，处理设备像素比例
 * @param position - 原始位置
 * @param lastClientPosition - 上一次客户端位置
 * @returns 规范化后的位置
 */
function normalizeDragPosition(
  position: { x: number; y: number },
  lastClientPosition: { x: number; y: number } | null,
) {
  const scale = window.devicePixelRatio || 1;
  if (scale === 1 || !lastClientPosition) {
    return getDragPosition(position);
  }
  const logicalDistance = Math.hypot(
    position.x - lastClientPosition.x,
    position.y - lastClientPosition.y,
  );
  const scaled = { x: position.x / scale, y: position.y / scale };
  const scaledDistance = Math.hypot(
    scaled.x - lastClientPosition.x,
    scaled.y - lastClientPosition.y,
  );
  return scaledDistance < logicalDistance ? scaled : position;
}

function pointInsideRect(
  position: { x: number; y: number },
  rect: DOMRect,
) {
  return (
    position.x >= rect.left &&
    position.x <= rect.right &&
    position.y >= rect.top &&
    position.y <= rect.bottom
  );
}

function normalizeViewportPosition(position: { x: number; y: number }) {
  const scale = window.devicePixelRatio || 1;
  if (
    scale <= 1 ||
    (position.x <= window.innerWidth && position.y <= window.innerHeight)
  ) {
    return position;
  }
  return { x: position.x / scale, y: position.y / scale };
}

/**
 * Composer 图片拖放钩子参数
 */
type UseComposerImageDropArgs = {
  /** 是否禁用 */
  disabled: boolean;
  /** 附加文件回调 */
  onAttachFiles?: (paths: string[]) => void;
  /** 附加图片路径回调 */
  onAttachImages?: (images: string[]) => void;
};

function readClipboardImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error(`Failed to read clipboard image: ${file.name || "image"}`));
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.startsWith("data:")) {
        reject(new Error("Clipboard image did not produce a data URL"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function saveClipboardImageFiles(files: File[]) {
  return Promise.all(files.map((file) => readClipboardImageAsDataUrl(file).catch(() => "")))
    .then((dataUrls) => {
      const uniqueDataUrls = Array.from(new Set(dataUrls.filter(Boolean)));
      return Promise.all(uniqueDataUrls.map((dataUrl) => saveClipboardImageDataUrl(dataUrl).catch((error) => {
        console.error("Failed to save pasted image", error);
        return "";
      })));
    })
    .then((paths) => Array.from(new Set(paths.filter(Boolean))));
}

/**
 * Composer 图片拖放钩子
 * 处理编辑器的图片拖放、粘贴等操作
 */
export function useComposerImageDrop({
  disabled,
  onAttachFiles,
  onAttachImages,
}: UseComposerImageDropArgs) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dropTargetRef = useRef<HTMLDivElement | null>(null);
  const lastClientPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pendingDomDropTimerRef = useRef<number | null>(null);
  const lastAttachRef = useRef<{ at: number; paths: string[] } | null>(null);

  const clearPendingDomDrop = useCallback(() => {
    if (pendingDomDropTimerRef.current == null) {
      return;
    }
    window.clearTimeout(pendingDomDropTimerRef.current);
    pendingDomDropTimerRef.current = null;
  }, []);

  const resetDragState = useCallback(() => {
    setIsDragOver(false);
    lastClientPositionRef.current = null;
    setAttachmentDragHoveringComposer(false);
  }, []);

  const attachFiles = useCallback((paths: string[]) => {
    const nextPaths = paths.map((path) => path.trim()).filter(Boolean);
    if (nextPaths.length === 0) {
      return;
    }
    const now = Date.now();
    const previous = lastAttachRef.current;
    if (
      previous &&
      now - previous.at < 750 &&
      previous.paths.length === nextPaths.length &&
      previous.paths.every((value, index) => value === nextPaths[index])
    ) {
      return;
    }
    lastAttachRef.current = { at: now, paths: nextPaths };
    onAttachFiles?.(nextPaths);
  }, [onAttachFiles]);

  const scheduleDomDropAttach = useCallback((paths: string[]) => {
    clearPendingDomDrop();
    pendingDomDropTimerRef.current = window.setTimeout(() => {
      pendingDomDropTimerRef.current = null;
      attachFiles(paths);
    }, 120);
  }, [attachFiles, clearPendingDomDrop]);

  const attachNativeClipboardImage = useCallback(() => (
    readClipboardImagePath()
      .then((clipboardPath) => {
        if (clipboardPath) {
          onAttachImages?.([clipboardPath]);
        }
      })
      .catch(() => undefined)
  ), [onAttachImages]);

  const isInsideDropTarget = useCallback((x: number, y: number) => {
    const target = dropTargetRef.current;
    if (!target) {
      return false;
    }
    const rect = target.getBoundingClientRect();
    return pointInsideRect(normalizeViewportPosition({ x, y }), rect);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    if (disabled) {
      return undefined;
    }
    unlisten = subscribeWindowDragDrop((event) => {
      if (!dropTargetRef.current) {
        return;
      }
      if (event.payload.type === "leave") {
        resetDragState();
        return;
      }
      const position = normalizeDragPosition(
        event.payload.position,
        lastClientPositionRef.current,
      );
      const isInside = isInsideDropTarget(position.x, position.y);
      if (event.payload.type === "over" || event.payload.type === "enter") {
        setIsDragOver(isInside);
        setAttachmentDragHoveringComposer(isInside);
        return;
      }
      if (event.payload.type === "drop") {
        resetDragState();
        if (!isInside) {
          return;
        }
        clearPendingDomDrop();
        attachFiles(event.payload.paths ?? []);
        clearAttachmentDragSession();
      }
    });
    return () => {
      clearPendingDomDrop();
      resetDragState();
      if (unlisten) {
        unlisten();
      }
    };
  }, [attachFiles, clearPendingDomDrop, disabled, isInsideDropTarget, resetDragState]);

  useEffect(() => {
    if (disabled) {
      return undefined;
    }

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (!isDragFileTransfer(event.dataTransfer?.types)) {
        return;
      }
      if (!isInsideDropTarget(event.clientX, event.clientY)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setIsDragOver(true);
      setAttachmentDragHoveringComposer(true);
    };

    const handleWindowDrop = (event: globalThis.DragEvent) => {
      if (!isDragFileTransfer(event.dataTransfer?.types)) {
        return;
      }
      const sessionPaths = getAttachmentDragSessionPaths();
      const droppedPaths = extractPathsFromTransferData(event.dataTransfer);
      const resolvedPaths = droppedPaths.length > 0 ? droppedPaths : sessionPaths;
      resetDragState();
      if (!isInsideDropTarget(event.clientX, event.clientY)) {
        clearAttachmentDragSession();
        return;
      }
      event.preventDefault();
      if (resolvedPaths.length === 0) {
        clearAttachmentDragSession();
        return;
      }
      clearPendingDomDrop();
      attachFiles(resolvedPaths);
      clearAttachmentDragSession();
    };

    const handleWindowDragLeave = () => {
      resetDragState();
    };

    const handleWindowDragEnd = () => {
      resetDragState();
      clearAttachmentDragSession();
    };

    const handleWindowMouseUp = () => {
      resetDragState();
    };

    window.addEventListener("dragover", handleWindowDragOver, true);
    window.addEventListener("dragleave", handleWindowDragLeave, true);
    window.addEventListener("drop", handleWindowDrop, true);
    window.addEventListener("dragend", handleWindowDragEnd, true);
    window.addEventListener("mouseup", handleWindowMouseUp, true);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver, true);
      window.removeEventListener("dragleave", handleWindowDragLeave, true);
      window.removeEventListener("drop", handleWindowDrop, true);
      window.removeEventListener("dragend", handleWindowDragEnd, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);
    };
  }, [attachFiles, clearPendingDomDrop, disabled, isInsideDropTarget, resetDragState]);

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }
    if (isDragFileTransfer(event.dataTransfer?.types)) {
      lastClientPositionRef.current = { x: event.clientX, y: event.clientY };
      event.dataTransfer.dropEffect = "copy";
      event.preventDefault();
      setIsDragOver(true);
      setAttachmentDragHoveringComposer(true);
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    handleDragOver(event);
  };

  const handleDragLeave = () => {
    resetDragState();
  };

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }
    event.preventDefault();
    resetDragState();
    const filePaths = extractPathsFromTransferData(event.dataTransfer);
    clearAttachmentDragSession();
    if (filePaths.length > 0) {
      scheduleDomDropAttach(filePaths);
      return;
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    const pastedPaths = extractPathsFromClipboard(event.clipboardData);
    if (pastedPaths.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      attachFiles(pastedPaths);
      return;
    }
    const imageFiles = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);
    if (imageFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      void saveClipboardImageFiles(imageFiles).then((paths) => {
        if (paths.length > 0) {
          onAttachImages?.(paths);
          return;
        }
        return attachNativeClipboardImage();
      });
      return;
    }

    void readClipboardFilePaths()
      .then((clipboardPaths) => {
        if (clipboardPaths.length > 0) {
          attachFiles(clipboardPaths);
          return;
        }
        return attachNativeClipboardImage();
      })
      .catch(() => []);
  };

  return {
    dropTargetRef,
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handlePaste,
  };
}
