import Prism, { type Grammar, type Token } from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-batch";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-go";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-makefile";
import "prismjs/components/prism-nginx";
import "prismjs/components/prism-php";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-protobuf";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-shell-session";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-yaml";

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  astro: "markup",
  bash: "bash",
  bat: "batch",
  cjs: "javascript",
  cmd: "batch",
  conf: "ini",
  config: "ini",
  c: "c",
  cfg: "ini",
  cnf: "ini",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hxx: "cpp",
  hh: "cpp",
  cs: "csharp",
  cshtml: "html",
  csproj: "xml",
  css: "css",
  csv: "text",
  dart: "dart",
  diff: "diff",
  dockerfile: "dockerfile",
  env: "ini",
  erb: "markup",
  fs: "fsharp",
  fsx: "fsharp",
  fsi: "fsharp",
  gql: "graphql",
  graphql: "graphql",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "markup",
  htm: "markup",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "json",
  jsonc: "json",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  less: "css",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  mtsx: "tsx",
  mk: "makefile",
  mak: "makefile",
  nginx: "nginx",
  njs: "javascript",
  pl: "perl",
  pm: "perl",
  php: "php",
  proto: "protobuf",
  prisma: "sql",
  ps1: "powershell",
  ps1xml: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  psrc: "powershell",
  pssc: "powershell",
  py: "python",
  pyc: "python",
  pyd: "python",
  pyi: "python",
  pyw: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  scss: "scss",
  sh: "bash",
  fish: "bash",
  ksh: "bash",
  shtml: "markup",
  sln: "plaintext",
  svelte: "html",
  svg: "html",
  properties: "ini",
  patch: "diff",
  service: "ini",
  sql: "sql",
  styl: "css",
  stylus: "css",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  vue: "html",
  xaml: "markup",
  xml: "markup",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const BASENAME_TO_LANGUAGE: Record<string, string> = {
  ".editorconfig": "ini",
  ".env": "ini",
  ".env.example": "ini",
  ".env.local": "ini",
  ".gitattributes": "ini",
  ".gitignore": "ini",
  ".gitconfig": "ini",
  ".npmrc": "ini",
  ".nvmrc": "text",
  ".prettierignore": "ini",
  ".prettierrc": "json",
  ".prettierrc.json": "json",
  ".prettierrc.yml": "yaml",
  ".prettierrc.yaml": "yaml",
  ".prettierrc.js": "javascript",
  ".prettierrc.cjs": "javascript",
  ".eslintrc": "json",
  ".eslintrc.json": "json",
  ".eslintrc.yml": "yaml",
  ".eslintrc.yaml": "yaml",
  ".eslintrc.js": "javascript",
  ".eslintrc.cjs": "javascript",
  ".bash_profile": "bash",
  ".bashrc": "bash",
  ".envrc": "bash",
  ".kshrc": "bash",
  ".profile": "bash",
  ".zprofile": "bash",
  ".zshenv": "bash",
  ".zshrc": "bash",
  "dockerfile": "dockerfile",
  "containerfile": "dockerfile",
  "bashrc": "bash",
  "config": "ini",
  "gnumakefile": "makefile",
  "makefile": "makefile",
  "compose.yaml": "yaml",
  "compose.yml": "yaml",
  "package-lock.json": "json",
  "tsconfig.json": "json",
  "jsconfig.json": "json",
  "bun.lock": "text",
  "cargo.toml": "toml",
  "cargo.lock": "toml",
  "nginx.conf": "nginx",
  "profile": "bash",
  "zshrc": "bash",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function languageFromPath(path?: string | null) {
  if (!path) {
    return null;
  }
  const fileName = path.split("/").pop() ?? path;
  const normalizedFileName = fileName.toLowerCase();
  const basenameLanguage = BASENAME_TO_LANGUAGE[normalizedFileName];
  if (basenameLanguage) {
    return basenameLanguage;
  }
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return null;
  }
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

export function highlightLine(text: string, language?: string | null) {
  if (!language || !(Prism.languages as Record<string, unknown>)[language]) {
    return escapeHtml(text);
  }
  return Prism.highlight(
    text,
    Prism.languages[language] as Grammar,
    language,
  );
}

export function highlightCodeBlock(text: string, language?: string | null) {
  if (!language || !(Prism.languages as Record<string, unknown>)[language]) {
    return escapeHtml(text);
  }
  return Prism.highlight(
    text,
    Prism.languages[language] as Grammar,
    language,
  );
}

export type HighlightTokenNode =
  | string
  | {
      types: string[];
      content: HighlightTokenNode[];
    };

function normalizeTokenContent(content: string | Token | Array<string | Token>): HighlightTokenNode[] {
  if (typeof content === "string") {
    return [content];
  }
  if (Array.isArray(content)) {
    return content.flatMap((item) => normalizeTokenContent(item));
  }
  return [
    {
      types: Array.isArray(content.alias)
        ? [content.type, ...content.alias]
        : typeof content.alias === "string"
          ? [content.type, content.alias]
          : [content.type],
      content: normalizeTokenContent(content.content),
    },
  ];
}

export function tokenizeCode(text: string, language?: string | null): HighlightTokenNode[] {
  if (!language || !(Prism.languages as Record<string, unknown>)[language]) {
    return [text];
  }
  return Prism.tokenize(text, Prism.languages[language] as Grammar).flatMap((token) =>
    normalizeTokenContent(token),
  );
}
