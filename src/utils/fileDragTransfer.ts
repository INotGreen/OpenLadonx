import {
  ATTACHMENT_PATHS_MIME,
  parseAttachmentPaths,
} from "./attachmentDragData";
import { getAttachmentDragSessionPaths } from "./attachmentDragSession";

export function isDragFileTransfer(types: readonly string[] | undefined) {
  if (getAttachmentDragSessionPaths().length > 0) {
    return true;
  }
  if (!types || types.length === 0) {
    return false;
  }
  return (
    types.includes(ATTACHMENT_PATHS_MIME) ||
    types.includes("Files") ||
    types.includes("text/uri-list") ||
    types.includes("public.file-url") ||
    types.includes("application/x-moz-file")
  );
}

export function decodeDroppedFileUri(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return "";
  }
  if (/^(\/|~\/|[A-Za-z]:[\\/])/.test(trimmed)) {
    return trimmed;
  }
  if (!/^file:/i.test(trimmed)) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    let pathname = decodeURIComponent(url.pathname);
    if (/^[A-Za-z]:/.test(pathname.slice(1))) {
      pathname = pathname.slice(1);
    }
    return pathname || "";
  } catch {
    return "";
  }
}

function splitTransferLines(value: string) {
  return value.split("\0").flatMap((part) => part.split(/\r?\n/));
}

export function extractPathsFromTransferData(
  dataTransfer: DataTransfer | null | undefined,
) {
  if (!dataTransfer) {
    return [];
  }
  const attachmentPaths = parseAttachmentPaths(
    dataTransfer.getData(ATTACHMENT_PATHS_MIME),
  );
  if (attachmentPaths.length > 0) {
    return attachmentPaths;
  }
  const internalDragPaths = getAttachmentDragSessionPaths();
  if (internalDragPaths.length > 0) {
    return internalDragPaths;
  }
  const directFilePaths = [
    ...Array.from(dataTransfer.files ?? []),
    ...Array.from(dataTransfer.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file)),
  ]
    .map((file) => (file as File & { path?: string }).path ?? "")
    .filter(Boolean);
  if (directFilePaths.length > 0) {
    return Array.from(new Set(directFilePaths));
  }
  const rawTransferText = [
    dataTransfer.getData("text/uri-list"),
    dataTransfer.getData("text/plain"),
    dataTransfer.getData("public.file-url"),
  ]
    .filter(Boolean)
    .join("\n");
  if (!rawTransferText) {
    return [];
  }
  return Array.from(
    new Set(
      splitTransferLines(rawTransferText)
        .map((value) => decodeDroppedFileUri(value))
        .filter(Boolean),
    ),
  );
}
