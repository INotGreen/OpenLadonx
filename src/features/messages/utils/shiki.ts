import { codeToHtml } from "shiki";

export type ResolvedAppTheme = "light" | "dark";

const SHIKI_THEMES: Record<ResolvedAppTheme, string> = {
  light: "vitesse-light",
  dark: "vitesse-black",
};

const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\x1B\[[0-9;?]*[ -/]*[@-~]`);
const POWERSHELL_COMMAND_PATTERN =
  /(?:^|[\s;&|])(powershell(?:\.exe)?|pwsh(?:\.exe)?|get-childitem|set-location|new-item|remove-item|copy-item|move-item|where-object|select-object|write-host)\b/i;
const CMD_COMMAND_PATTERN = /(?:^|[\s;&|])(?:cmd(?:\.exe)?|dir|copy|move|del|type|set|echo|for|if)\b/i;

const commandHighlightCache = new Map<string, Promise<string>>();
const codeBlockHighlightCache = new Map<string, Promise<string>>();
const resolvedHighlightCache = new Map<string, string>();

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildFallbackHtml(value: string, className: string) {
  return `<pre class="${className}"><code>${escapeHtml(value)}</code></pre>`;
}

function normalizeCodeLanguage(language?: string | null) {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "text" || normalized === "plain" || normalized === "plaintext") {
    return null;
  }
  return normalized;
}

export function detectCommandOutputLanguage(value: string) {
  return ANSI_ESCAPE_PATTERN.test(value) ? "ansi" : "shellsession";
}

export function detectShellCommandLanguage(value: string) {
  if (POWERSHELL_COMMAND_PATTERN.test(value)) {
    return "powershell";
  }
  if (CMD_COMMAND_PATTERN.test(value) && !/[|&;]\s*(grep|awk|sed|cat|ls|cd|mkdir|rm|cp|mv)\b/.test(value)) {
    return "batch";
  }
  return "shellscript";
}

export function getResolvedAppTheme(): ResolvedAppTheme {
  if (typeof document === "undefined") {
    return "dark";
  }
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light") {
    return "light";
  }
  if (explicit === "dark") {
    return "dark";
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

export function highlightCommandOutputHtml(value: string) {
  const theme = getResolvedAppTheme();
  const language = detectCommandOutputLanguage(value);
  const cacheKey = `${theme}::${language}::${value}`;
  const cached = commandHighlightCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const promise = codeToHtml(value, {
    lang: language,
    theme: SHIKI_THEMES[theme],
  })
    .catch(() => buildFallbackHtml(value, "tool-inline-terminal-shiki-fallback"))
    .then((html) => {
      resolvedHighlightCache.set(cacheKey, html);
      return html;
    });
  commandHighlightCache.set(cacheKey, promise);
  return promise;
}

export function highlightCodeBlockHtml(value: string, language?: string | null) {
  const theme = getResolvedAppTheme();
  const normalizedLanguage = normalizeCodeLanguage(language);
  const cacheKey = `${theme}::${normalizedLanguage ?? "plain"}::${value}`;
  const cached = codeBlockHighlightCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const promise = normalizedLanguage
    ? codeToHtml(value, {
        lang: normalizedLanguage,
        theme: SHIKI_THEMES[theme],
      }).catch(() => buildFallbackHtml(value, "markdown-codeblock-shiki-fallback"))
    : Promise.resolve(buildFallbackHtml(value, "markdown-codeblock-shiki-fallback"));
  const cachedPromise = promise.then((html) => {
    resolvedHighlightCache.set(cacheKey, html);
    return html;
  });
  codeBlockHighlightCache.set(cacheKey, cachedPromise);
  return cachedPromise;
}

export function getCachedCommandOutputHtml(value: string) {
  const theme = getResolvedAppTheme();
  const language = detectCommandOutputLanguage(value);
  return resolvedHighlightCache.get(`${theme}::${language}::${value}`) ?? "";
}

export function getCachedCodeBlockHtml(value: string, language?: string | null) {
  const theme = getResolvedAppTheme();
  const normalizedLanguage = normalizeCodeLanguage(language);
  return resolvedHighlightCache.get(`${theme}::${normalizedLanguage ?? "plain"}::${value}`) ?? "";
}

export function getFallbackCodeBlockHtml(value: string) {
  return buildFallbackHtml(value, "markdown-codeblock-shiki-fallback");
}

export function getFallbackCommandOutputHtml(value: string) {
  return buildFallbackHtml(value, "tool-inline-terminal-shiki-fallback");
}
