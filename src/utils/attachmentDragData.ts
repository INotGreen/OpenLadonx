export const ATTACHMENT_PATHS_MIME = "application/x-ladonx-attachment-paths";

export function serializeAttachmentPaths(paths: string[]) {
  return JSON.stringify(paths.map((path) => path.trim()).filter(Boolean));
}

export function parseAttachmentPaths(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return Array.from(
        new Set(
          parsed
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean),
        ),
      );
    }
  } catch {
    // Fall through to line parsing for older/plain drag payloads.
  }
  return Array.from(
    new Set(
      trimmed
        .split("\0")
        .flatMap((part) => part.split(/\r?\n/))
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  );
}

function pathToFileUri(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized.split("/").map(encodeURIComponent).join("/")}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized.split("/").map(encodeURIComponent).join("/")}`;
  }
  return "";
}

export function writeAttachmentPathsToDataTransfer(
  dataTransfer: DataTransfer,
  paths: string[],
) {
  const normalizedPaths = Array.from(
    new Set(paths.map((path) => path.trim()).filter(Boolean)),
  );
  if (normalizedPaths.length === 0) {
    return;
  }
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(
    ATTACHMENT_PATHS_MIME,
    serializeAttachmentPaths(normalizedPaths),
  );
  const fileUris = normalizedPaths.map(pathToFileUri).filter(Boolean);
  if (fileUris.length > 0) {
    dataTransfer.setData("text/uri-list", fileUris.join("\n"));
  }
  dataTransfer.setData("text/plain", normalizedPaths.join("\n"));
}
