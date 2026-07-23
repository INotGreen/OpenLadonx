import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const resourcesDir = path.join(root, "src-tauri", "resources");
const allPlatforms = process.argv.includes("--all");

const configToml = `model_provider = "custom"
model = "gpt-5.5"
disable_response_storage = true
model_reasoning_effort = "high"
approvals_reviewer = "user"
personality = "friendly"
base_url = "REPLACE_BASE_URL"

[model_providers]

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = false
base_url = "REPLACE_BASE_URL"

[tui.model_availability_nux]
"gpt-5.5" = 4

[features]
collaboration_modes = true
steer = true
unified_exec = true
apps = true
js_repl = false
multi_agent = true


[agents]
max_threads = 6
max_depth = 1
`;

const agentsMd = `




代码风格：
1. 优先可读性，不要为了抽象而抽象。
2. 不要创建只被调用一次的函数。
3. 不要创建只有一个实现的接口。
4. 不要用设计模式包装简单逻辑。
5. 小项目优先使用扁平结构，尽量控制调用深度不超过 2 层。
6. 函数超过 100 行再考虑拆分，避免过早拆成很多零碎 helper。
7. 删除无意义的 helper 函数，能内联就内联。
8. 可读性优先于复用性，避免过早抽象。
9. 遵循 YAGNI，只实现当前真正需要的内容。
10. 写资深工程师风格的代码，不要写成教程式代码。
11. 表达式能写成单行就尽量单行，不要仅为“好看”强行换行。
12. 避免多行条件语句和跨多行格式化的三元表达式。
13. 代码保持紧凑，但不要过度嵌套。
`;

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function ensureTextFile(relativePath, content) {
  const target = path.join(resourcesDir, relativePath);
  if (isFile(target)) {
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log(`[sync:tauri-resources] wrote ${relativePath}`);
}

function pathEntries() {
  return (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
}

function commandNames(name) {
  if (process.platform !== "win32") {
    return [name];
  }
  const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  return path.extname(name) ? [name] : exts.map((ext) => `${name}${ext.toLowerCase()}`);
}

function findCommand(name) {
  for (const dir of pathEntries()) {
    for (const command of commandNames(name)) {
      const candidate = path.join(dir, command);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function binaryCandidates(tool) {
  const envName = `LADONX_${tool.toUpperCase()}_BIN`;
  return unique([
    process.env[envName],
    process.env[`${tool.toUpperCase()}_BIN`],
    findCommand(tool),
    findCommand(`${tool}.exe`),
  ]);
}

function chmodExecutable(filePath) {
  if (process.platform === "win32") {
    return;
  }
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // Best effort: later doctor/cargo output will surface hard permission failures.
  }
}

function copyBinary(relativePath, tool) {
  const target = path.join(resourcesDir, relativePath);
  if (isFile(target)) {
    chmodExecutable(target);
    return;
  }

  const source = binaryCandidates(tool).find((candidate) => path.resolve(candidate) !== path.resolve(target) && isFile(candidate));
  if (!source) {
    missing.push({ relativePath, tool });
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  chmodExecutable(target);
  console.log(`[sync:tauri-resources] copied ${relativePath} from ${source}`);
}

function currentResourceTargets() {
  if (process.platform === "darwin") {
    return [{ platform: "macos", arch: os.arch() === "x64" ? "x64" : "arm64", exe: "" }];
  }
  if (process.platform === "win32") {
    return [{ platform: "windows", arch: os.arch() === "arm64" ? "arm64" : "x64", exe: ".exe" }];
  }
  return [];
}

function allResourceTargets() {
  return [
    { platform: "macos", arch: "x64", exe: "" },
    { platform: "macos", arch: "arm64", exe: "" },
    { platform: "windows", arch: "x64", exe: ".exe" },
    { platform: "windows", arch: "arm64", exe: ".exe" },
  ];
}

const missing = [];
ensureTextFile("config.toml", configToml);
ensureTextFile("AGENTS.md", agentsMd);

const targets = allPlatforms ? allResourceTargets() : currentResourceTargets();
for (const target of targets) {
  copyBinary(path.join(target.platform, target.arch, `codex${target.exe}`), "codex");
  copyBinary(path.join(target.platform, target.arch, `claude${target.exe}`), "claude");
  copyBinary(path.join(target.platform, target.arch, `rg${target.exe}`), "rg");
}

if (missing.length > 0) {
  const details = missing.map((entry) => `  - ${entry.relativePath} (${entry.tool})`).join("\n");
  console.error(`[sync:tauri-resources] missing required resources:\n${details}`);
  console.error("[sync:tauri-resources] Put binaries on PATH or set LADONX_CODEX_BIN, LADONX_CLAUDE_BIN, and LADONX_RG_BIN.");
  process.exit(1);
}

console.log(`[sync:tauri-resources] OK (${allPlatforms ? "all platforms" : "current platform"})`);
