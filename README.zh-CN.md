# OpenLadonx

[English](README.md) | [简体中文](README.zh-CN.md)

OpenLadonx 是一个桌面端 AI 编程工作台，基于 React、Vite、TypeScript 和 Tauri 2 构建。它把 Codex 风格的 agent 工作流放进原生桌面应用：工作区管理、线程会话、Git 审查、终端面板、模型配置、skills、plugins、MCP 服务状态以及本地桌面集成都可以在一个界面里完成。

这个项目面向想要“本地优先 agent 控制台”的用户。你可以使用默认模型凭据，也可以添加自己的兼容模型端点；目前自定义模型只需要兼容 OpenAI Responses 风格 API 或 Anthropic Messages 风格 API。

## 核心特性

- 基于 Tauri 2 和 Rust 的原生桌面外壳。
- 基于 Vite 的 React 19 + TypeScript 前端。
- 支持工作区感知的聊天线程、文件预览、终端面板、Git diff、分支工具与 PR 辅助。
- 支持自定义接入兼容 `/v1/responses` 和 `/v1/messages` 的模型端点。
- 支持在输入框和线程工作流中使用 skills、plugins、prompts 与文件 token 自动补全。
- 支持渲染 MCP 工具调用，并查看工作区 MCP server 状态。
- 支持编辑全局 `AGENTS.md` 和 Codex `config.toml`。
- 提供中英文 README 文档。

## 模型支持

OpenLadonx 的自定义模型支持两类 API 协议：

| 设置中的协议 | 期望的端点风格 | 适用场景 |
| --- | --- | --- |
| `OpenAI/Response` | `/v1/responses` | 兼容 OpenAI Responses API 的服务商或路由器。 |
| `Anthropic/Messages` | `/v1/messages` | 兼容 Anthropic Messages API 的服务商或路由器。 |

添加模型的步骤：

1. 打开 **Settings**。
2. 进入模型/API key 相关区域。
3. 点击 **添加模型**。
4. 选择 `OpenAI/Response` 或 `Anthropic/Messages`。
5. 填写接口地址、API Key，以及一个或多个模型 ID。
6. 使用内置测试请求验证配置。
7. 保存配置后，模型会出现在模型选择器中。

保存自定义模型后，应用会切换到本地自定义 API 配置。自定义模型配置保存在本地，请不要提交本地密钥或生成的配置文件。

## 外接工具能力

OpenLadonx 围绕可扩展 agent 工作流设计：

- **Skills**：在输入框和线程流程中发现、选择并使用 skill 指令。
- **Plugins**：支持列出已配置插件、浏览插件市场条目、安装插件和卸载插件。
- **MCP**：支持在线程中展示 MCP 工具调用，并查看工作区 MCP server 状态。
- **Prompts 与 AGENTS.md**：可以从桌面 UI 编辑全局和工作区级指令。
- **GitHub 与 Git 工具**：支持查看仓库状态、分支、提交、diff、issues、pull requests 和审查上下文。

## 项目结构

```text
.
├── public/              # 静态 Web 资源
├── src/                 # React 应用代码
│   ├── features/        # 功能模块
│   ├── hooks/           # 共享 React hooks
│   ├── services/        # 应用与 Tauri 服务客户端
│   ├── styles/          # 全局与设计系统样式
│   ├── test/            # Vitest 测试配置
│   └── utils/           # 共享工具函数
├── src-tauri/           # Tauri 配置与 Rust 代码
│   ├── src/             # Rust 命令、服务与应用装配
│   └── tests/           # Rust 集成测试
├── scripts/             # 构建、doctor、发布与维护脚本
└── docs/                # 项目文档与静态文档站点
```

## 环境要求

- Node.js 与 npm。
- Rust 工具链与 Cargo。
- 当前平台所需的 Tauri 系统依赖。
- 默认服务商凭据，或一个兼容的自定义模型端点。

桌面构建前建议运行严格 doctor 检查，提前发现缺失的原生依赖：

```sh
npm run doctor:strict
```

## 快速开始

安装 JavaScript 依赖：

```sh
npm install
```

仅启动 Vite 前端开发服务：

```sh
npm run dev
```

启动完整 Tauri 桌面应用：

```sh
npm run tauri:dev
```

## 开发命令

```sh
npm run build
npm run lint
npm run test
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

如果修改了 Rust/Tauri 代码，建议在 `src-tauri/` 下运行更聚焦的检查或测试：

```sh
cd src-tauri
cargo check
cargo test
```

## 配置说明

OpenLadonx 会读取和写入本地桌面设置、Codex 配置以及工作区指令文件。常见本地配置包括：

- API key 与 base URL。
- 自定义 Response API 和 Messages API 的模型列表。
- 全局 `AGENTS.md` 指令。
- Codex `config.toml` 内容。
- 由底层 agent 环境管理的插件启用状态和 MCP 配置。

不要提交 API keys、tokens、签名配置、生成产物、本地登录文件或本机专属配置。当前 `.gitignore` 已排除常见构建产物和本地凭据文件，例如 `src-tauri/ladonx_auth.json`。

仓库提供 `.testflight.local.env.example` 作为本地发布配置参考。需要时可复制为被忽略的本地配置文件。

## 贡献指南

- TypeScript 和 TSX 使用 2 空格缩进。
- React 组件使用 `PascalCase`，hooks 使用 `useSomething`，工具函数使用 `camelCase`，Rust 函数使用 `snake_case`。
- 优先使用已配置的路径别名，例如 `@/`、`@app/`、`@services/` 和 `@utils/`。
- 前端 IPC 契约需要与 Rust Tauri 命令和载荷类型保持同步。
- 修改功能或模块时，请添加聚焦的测试。
- 提交 PR 前建议运行 `npm run typecheck`、`npm run lint` 和相关测试。

## 许可证

本项目使用 [LICENSE](LICENSE) 中声明的许可证。
