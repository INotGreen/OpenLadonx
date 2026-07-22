import { useMemo, useState, useEffect } from "react";
import { codeToHtml } from "shiki";
import { languageFromPath } from "../../../utils/syntax";

type PierreDiffBlockProps = {
  diff: string;
  displayPath: string;
  defaultExpanded?: boolean;
  hidePatchMetadata?: boolean;
  oldLines?: string[];
  newLines?: string[];
  diffStyle?: "split" | "unified";
  onPreviewFile?: (path: string) => void;
};

const shikiDiffCache = new Map<string, Promise<string>>();

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isDiffMetadataLine(line: string) {
  return (
    line.startsWith("diff --git")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
    || line.startsWith("@@")
    || line.startsWith("\\ No newline")
  );
}

function isPatchFileHeaderLine(line: string) {
  return (
    line.startsWith("diff --git")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
  );
}

function shikiLanguageFromPath(path: string) {
  switch (languageFromPath(path)) {
    case "text":
      return null;
    case "markup":
      return "html";
    case "batch":
      return "bat";
    case "shell-session":
      return "shell";
    case "protobuf":
      return "proto";
    default:
      return languageFromPath(path);
  }
}

function extractShikiLineHtml(html: string) {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html");
    return Array.from(document.querySelectorAll("span.line"), (line) => line.innerHTML);
  }
  return Array.from(
    html.matchAll(/<span class="line">([\s\S]*?)<\/span>/g),
    (match) => match[1] ?? "",
  );
}

function parseHunkHeader(line: string) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) {
    return null;
  }

  return {
    oldStart: Number(match[1]),
    newStart: Number(match[3]),
  };
}

function renderLineNumber(value: number | null) {
  return value == null ? "&nbsp;" : escapeHtml(String(value));
}

async function buildShikiDiffHtml(diff: string, displayPath: string) {
  const language = shikiLanguageFromPath(displayPath);
  const lines = diff.split("\n");
  const codeLines = lines
    .filter((line) => !isDiffMetadataLine(line) && /^[+\- ]/.test(line))
    .map((line) => line.slice(1));

  let highlightedCodeLines: string[] = [];
  if (language && codeLines.length > 0) {
    try {
      const html = await codeToHtml(codeLines.join("\n"), {
        lang: language,
        theme: "vitesse-black",
      });
      highlightedCodeLines = extractShikiLineHtml(html);
    } catch {
      highlightedCodeLines = [];
    }
  }

  let codeIndex = 0;
  let oldLineNumber: number | null = 1;
  let newLineNumber: number | null = 1;
  const body = lines.map((line) => {
    if (line.startsWith("@@")) {
      const hunk = parseHunkHeader(line);
      oldLineNumber = hunk?.oldStart ?? 1;
      newLineNumber = hunk?.newStart ?? 1;
      return "";
    }
    if (isPatchFileHeaderLine(line)) {
      return `<div class="diff-viewer-shiki-line diff-viewer-shiki-line--meta"><span class="diff-viewer-shiki-line-number" aria-hidden="true">&nbsp;</span><span class="diff-viewer-shiki-content">${escapeHtml(line)}</span></div>`;
    }
    if (line.startsWith("\\ No newline")) {
      return `<div class="diff-viewer-shiki-line diff-viewer-shiki-line--note"><span class="diff-viewer-shiki-line-number" aria-hidden="true">&nbsp;</span><span class="diff-viewer-shiki-content">${escapeHtml(line)}</span></div>`;
    }
    if (/^[+\- ]/.test(line)) {
      const prefix = line[0] ?? " ";
      const typeClass = prefix === "+" ? "add" : prefix === "-" ? "del" : "ctx";
      const highlighted = highlightedCodeLines[codeIndex];
      codeIndex += 1;
      const content = highlighted ?? (escapeHtml(line.slice(1)) || "&nbsp;");
      const lineNumber = prefix === "+" ? newLineNumber : oldLineNumber;

      if (prefix !== "+") {
        oldLineNumber = oldLineNumber == null ? null : oldLineNumber + 1;
      }
      if (prefix !== "-") {
        newLineNumber = newLineNumber == null ? null : newLineNumber + 1;
      }

      return `<div class="diff-viewer-shiki-line diff-viewer-shiki-line--${typeClass}"><span class="diff-viewer-shiki-line-number" aria-hidden="true">${renderLineNumber(lineNumber)}</span><span class="diff-viewer-shiki-prefix">${escapeHtml(prefix)}</span><span class="diff-viewer-shiki-content">${content}</span></div>`;
    }
    return `<div class="diff-viewer-shiki-line diff-viewer-shiki-line--plain"><span class="diff-viewer-shiki-line-number" aria-hidden="true">&nbsp;</span><span class="diff-viewer-shiki-content">${escapeHtml(line) || "&nbsp;"}</span></div>`;
  }).join("");

  return `<div class="diff-viewer-shiki diff-viewer-shiki--numbered">${body}</div>`;
}

function buildPlainDiffWithLineNumbers(diff: string) {
  const lines = diff.split("\n");
  let oldLineNumber: number | null = 1;
  let newLineNumber: number | null = 1;

  return lines.map((line) => {
    if (line.startsWith("@@")) {
      const hunk = parseHunkHeader(line);
      oldLineNumber = hunk?.oldStart ?? 1;
      newLineNumber = hunk?.newStart ?? 1;
      return "";
    }

    if (/^[+\- ]/.test(line)) {
      const prefix = line[0] ?? " ";
      const lineNumber = prefix === "+" ? String(newLineNumber ?? "") : String(oldLineNumber ?? "");

      if (prefix !== "+") {
        oldLineNumber = oldLineNumber == null ? null : oldLineNumber + 1;
      }
      if (prefix !== "-") {
        newLineNumber = newLineNumber == null ? null : newLineNumber + 1;
      }

      return `${lineNumber.padStart(4, " ")} ${line}`;
    }

    return `     ${line}`;
  }).filter((line) => line !== "").join("\n");
}

function filterDisplayedDiff(diff: string, hidePatchMetadata: boolean) {
  return diff
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("@@")) {
        return false;
      }
      if (!hidePatchMetadata) {
        return true;
      }
      return (
        !trimmed.startsWith("diff --git") &&
        !trimmed.startsWith("index ") &&
        !trimmed.startsWith("--- ") &&
        !trimmed.startsWith("+++ ")
      );
    })
    .join("\n")
    .trim();
}

function buildRenderableDiff(diff: string, hidePatchMetadata: boolean) {
  const lines = diff.split("\n");
  const renderedLines: string[] = [];
  let pendingHunkHeader: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("@@")) {
      pendingHunkHeader = line;
      continue;
    }
    if (hidePatchMetadata && isPatchFileHeaderLine(trimmed)) {
      pendingHunkHeader = null;
      continue;
    }
    if (/^[+\- ]/.test(line)) {
      if (pendingHunkHeader) {
        renderedLines.push(pendingHunkHeader);
        pendingHunkHeader = null;
      }
      renderedLines.push(line);
      continue;
    }
    pendingHunkHeader = null;
    renderedLines.push(line);
  }

  return renderedLines.join("\n").trim();
}

function getHighlightedDiffHtml(diff: string, displayPath: string) {
  const cacheKey = `${displayPath}::${diff}`;
  const cached = shikiDiffCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const promise = buildShikiDiffHtml(diff, displayPath);
  shikiDiffCache.set(cacheKey, promise);
  return promise;
}

export function PierreDiffBlock({
  diff,
  displayPath,
  hidePatchMetadata = false,
}: Omit<PierreDiffBlockProps, "oldLines" | "newLines" | "diffStyle">) {
  const displayDiff = useMemo(
    () => filterDisplayedDiff(diff, hidePatchMetadata),
    [diff, hidePatchMetadata],
  );
  const renderableDiff = useMemo(
    () => buildRenderableDiff(diff, hidePatchMetadata),
    [diff, hidePatchMetadata],
  );
  const [highlightedDiffHtml, setHighlightedDiffHtml] = useState("");
  const plainDiffWithLineNumbers = useMemo(
    () => buildPlainDiffWithLineNumbers(renderableDiff),
    [renderableDiff],
  );

  useEffect(() => {
    let cancelled = false;
    setHighlightedDiffHtml("");
    getHighlightedDiffHtml(renderableDiff, displayPath).then((html) => {
      if (!cancelled) {
        setHighlightedDiffHtml(html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [renderableDiff, displayPath]);

  if (!displayDiff.trim()) {
    return <div className="diff-viewer-placeholder">Diff unavailable.</div>;
  }

  return (
    <div className="pierre-diff-block">
      {/* <div className="pierre-diff-header">
        <div className="pierre-diff-file">
          <div className="pierre-diff-path-row">
            <button
              type="button"
              className={`pierre-diff-path${onPreviewFile ? " is-clickable" : ""}`}
              title={displayPath}
              onClick={() => onPreviewFile?.(displayPath)}
            >
              {fileName}
            </button>
            <span
              className="diff-counts-inline pierre-diff-counts"
              aria-label={`+${diffStats.additions} -${diffStats.deletions}`}
            >
              <span className="diff-add">+{diffStats.additions}</span>
              <span className="diff-del">-{diffStats.deletions}</span>
            </span>
          </div>
        </div>
      </div> */}

        <div className="diff-viewer-shiki-shell inline-diff-preview">
          {highlightedDiffHtml ? (
            <div dangerouslySetInnerHTML={{ __html: highlightedDiffHtml }} />
          ) : (
            <pre className="diff-viewer-shiki-loading">{plainDiffWithLineNumbers}</pre>
          )}
        </div>
      
    </div>
  );
}
