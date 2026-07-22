//注释：这个文件是 ComposerAttachments 组件的代码，用于在 Composer 中显示附件。
import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import X from "lucide-react/dist/esm/icons/x";
import docIcon from "@/assets/svg-icons/doc.svg";
import docxIcon from "@/assets/svg-icons/docx.svg";
import excelIcon from "@/assets/svg-icons/excel.svg";
import mdIcon from "@/assets/svg-icons/md.svg";
import pdfIcon from "@/assets/svg-icons/pdf.svg";
import pngIcon from "@/assets/svg-icons/png.svg";
import pptIcon from "@/assets/svg-icons/ppt.svg";
import txtIcon from "@/assets/svg-icons/txt.svg";
import { isWorkspacePathDir, readBinaryFilePath } from "../../../services/tauri";

const FOLDER_ICON_URL = "/assets/material-icons/folder-open.svg";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "svg",
]);

const BINARY_EXTENSIONS = new Set([
  "7z",
  "avi",
  "bin",
  "class",
  "dll",
  "dmg",
  "doc",
  "eot",
  "exe",
  "flac",
  "gz",
  "ico",
  "jar",
  "m4a",
  "mov",
  "mp3",
  "mp4",
  "otf",
  "pdf",
  "ppt",
  "pptx",
  "pyc",
  "so",
  "tar",
  "ttf",
  "wav",
  "webm",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "zip",
]);

type ComposerAttachmentsProps = {
  attachments: string[];
  disabled: boolean;
  onRemoveAttachment?: (path: string) => void;
  onPreviewAttachment?: (path: string, kind?: "file" | "folder") => void;
};

function isDirectoryAttachmentHint(path: string) {
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return false;
  }
  return /[\\/]$/.test(path);
}

function fileTitle(path: string) {
  if (path.startsWith("data:")) {
    return "";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return "Image";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function attachmentPreviewSrc(path: string) {
  if (path.startsWith("data:")) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

function extensionOf(path: string) {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  return lastDot >= 0 ? normalized.slice(lastDot + 1) : "";
}

function attachmentKind(
  path: string,
  isDirectory: boolean,
): "folder" | "image" | "pdf" | "docx" | "xlsx" | "pptx" | "text" | "other" {
  if (isDirectory) {
    return "folder";
  }
  if (path.startsWith("data:image/")) {
    return "image";
  }
  const ext = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (ext === "pdf") {
    return "pdf";
  }
  if (ext === "docx") {
    return "docx";
  }
  if (["xlsx", "xls"].includes(ext)) {
    return "xlsx";
  }
  if (["pptx", "ppt"].includes(ext)) {
    return "pptx";
  }
  if (!ext) {
    return "text";
  }
  return BINARY_EXTENSIONS.has(ext) ? "other" : "text";
}

function attachmentIconSrc(path: string, isDirectory = false) {
  if (isDirectory) {
    return FOLDER_ICON_URL;
  }
  const ext = extensionOf(path);
  if (path.startsWith("data:image/")) {
    return pngIcon;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "svg"].includes(ext)) {
    return pngIcon;
  }
  if (ext === "pdf") {
    return pdfIcon;
  }
  if (ext === "docx") {
    return docxIcon;
  }
  if (ext === "doc") {
    return docIcon;
  }
  if (["xlsx", "xls", "csv"].includes(ext)) {
    return excelIcon;
  }
  if (["pptx", "ppt"].includes(ext)) {
    return pptIcon;
  }
  if (ext === "md") {
    return mdIcon;
  }
  if (["txt", "log"].includes(ext)) {
    return txtIcon;
  }
  return txtIcon;
}

export function ComposerAttachments({
  attachments,
  disabled,
  onRemoveAttachment,
  onPreviewAttachment,
}: ComposerAttachmentsProps) {
  const [directoryMap, setDirectoryMap] = useState<Record<string, boolean>>({});
  const [previewFallbackMap, setPreviewFallbackMap] = useState<Record<string, string>>({});
  const [brokenPreviewMap, setBrokenPreviewMap] = useState<Record<string, boolean>>({});
  const loadingPreviewFallbacksRef = useRef(new Set<string>());
  const previewObjectUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const localOnlyPaths = attachments.filter(
      (path) =>
        path &&
        !path.startsWith("data:") &&
        !path.startsWith("http://") &&
        !path.startsWith("https://"),
    );
    const unresolvedPaths = localOnlyPaths.filter((path) => !(path in directoryMap));
    if (unresolvedPaths.length === 0) {
      return undefined;
    }
    void Promise.all(
      unresolvedPaths.map(async (path) => {
        try {
          return [path, await isWorkspacePathDir(path)] as const;
        } catch {
          return [path, isDirectoryAttachmentHint(path)] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setDirectoryMap((current) => {
        const next = { ...current };
        for (const [path, isDir] of entries) {
          next[path] = isDir;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [attachments, directoryMap]);

  useEffect(() => {
    const previewObjectUrls = previewObjectUrlsRef.current;
    return () => {
      previewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      previewObjectUrls.clear();
    };
  }, []);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="composer-attachments">
      {attachments.map((path) => {
        const title = fileTitle(path);
        const titleAttr = path.startsWith("data:") ? "" : path;
        const isDirectory = directoryMap[path] ?? isDirectoryAttachmentHint(path);
        const kind = attachmentKind(path, isDirectory);
        const previewSrc = isDirectory ? "" : previewFallbackMap[path] ?? attachmentPreviewSrc(path);
        const iconSrc = attachmentIconSrc(path, isDirectory);
        const showMeta = kind !== "image";
        const canPreview =
          kind === "folder" ||
          kind === "image" ||
          kind === "pdf" ||
          kind === "docx" ||
          kind === "xlsx" ||
          kind === "pptx" ||
          kind === "text";
        return (
          <div
            key={path}
            className={`composer-attachment composer-attachment--${kind}`}
            title={titleAttr}
          >
            {previewSrc && kind === "image" && !brokenPreviewMap[path] ? (
              <button
                type="button"
                className="composer-attachment-thumb-button"
                onClick={() => onPreviewAttachment?.(path, "file")}
                aria-label="Preview image"
              >
                <span className="composer-attachment-thumb" aria-hidden>
                  <img
                    src={previewSrc}
                    alt=""
                    className="composer-attachment-thumb-image"
                    onError={() => {
                      if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
                        setBrokenPreviewMap((current) => ({ ...current, [path]: true }));
                        return;
                      }
                      if (previewFallbackMap[path] || loadingPreviewFallbacksRef.current.has(path)) {
                        setBrokenPreviewMap((current) => ({ ...current, [path]: true }));
                        return;
                      }
                      loadingPreviewFallbacksRef.current.add(path);
                      void readBinaryFilePath(path)
                        .then((response) => {
                          const binaryString = atob(response.base64);
                          const bytes = new Uint8Array(binaryString.length);
                          for (let index = 0; index < binaryString.length; index += 1) {
                            bytes[index] = binaryString.charCodeAt(index);
                          }
                          const objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: response.mime_type || "image/*" }));
                          previewObjectUrlsRef.current.add(objectUrl);
                          setPreviewFallbackMap((current) => ({ ...current, [path]: objectUrl }));
                          setBrokenPreviewMap((current) => {
                            const next = { ...current };
                            delete next[path];
                            return next;
                          });
                        })
                        .catch(() => {
                          setBrokenPreviewMap((current) => ({ ...current, [path]: true }));
                        })
                        .finally(() => {
                          loadingPreviewFallbacksRef.current.delete(path);
                        });
                    }}
                  />
                </span>
              </button>
            ) : (
              <span className="composer-icon" aria-hidden>
                <img src={iconSrc} alt="" className="composer-attachment-icon" />
              </span>
            )}
            {showMeta ? (
              <div className="composer-attachment-meta">
                <button
                  type="button"
                  className="composer-attachment-name"
                  onClick={() => {
                    if (canPreview) {
                      onPreviewAttachment?.(path, kind === "folder" ? "folder" : "file");
                    }
                  }}
                  disabled={!canPreview}
                >
                  {title}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="composer-attachment-remove"
              onClick={() => onRemoveAttachment?.(path)}
              aria-label={kind === "image" ? "Remove image" : `Remove ${title}`}
              disabled={disabled}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
