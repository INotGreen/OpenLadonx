# OpenLadonx

[English](README.md) | [简体中文](README.zh-CN.md)

![Version](https://img.shields.io/badge/version-0.7.68-blue)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
![React](https://img.shields.io/badge/React-19-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6)
![License](https://img.shields.io/badge/license-see%20LICENSE-lightgrey)

OpenLadonx 是一个原生桌面端 AI 编程工作台，面向 Codex 风格的 agent 工作流。它把聊天线程、工作区上下文、Git 审查、终端、模型路由、skills、plugins、MCP 服务状态和本地桌面集成放进一个 Tauri 应用。

你可以使用内置服务商路径，也可以接入自己的 OpenAI Responses 兼容端点和 Anthropic Messages 兼容端点。OpenLadonx 面向团队和高频用户，适合需要本地优先 agent 控制台，而不是再开一个浏览器标签页的工作方式。

![OpenLadonx proxy architecture](assets/flow.png)

## 为什么选择 OpenLadonx

- **一个桌面控制台**：统一承载 agent 会话、工作区、文件、终端、diff、分支、issues 和 pull requests。
- **接入自己的模型**：支持 OpenAI Responses 兼容的 `/v1/responses` 端点，以及 Anthropic Messages 兼容的 `/v1/messages` 端点。
- **原生工作流界面**：基于 Tauri 2、Rust、React 19、TypeScript、Vite 和本地文件系统集成。
- **可扩展 agent 环境**：支持 skills、plugins、prompts、MCP 工具调用渲染，以及工作区 `AGENTS.md` 编辑。
- **本地配置掌控**：管理模型凭据、Codex `config.toml`、插件状态、MCP 状态和桌面设置。

## 模型路由

OpenLadonx 在 Settings 中支持两类自定义 API 协议：

| 协议 | 端点风格 | 典型用途 |
| --- | --- | --- |
| `OpenAI/Response` | `/v1/responses` | 兼容 OpenAI Responses API 的服务商、路由器或代理层。 |
| `Anthropic/Messages` | `/v1/messages` | 兼容 Anthropic Messages API 的服务商、路由器或 Claude 风格模型界面。 |

添加模型：

1. 打开 **Settings**。
2. 进入模型/API key 相关区域。
3. 点击 **Add model**。
4. 选择 `OpenAI/Response` 或 `Anthropic/Messages`。
5. 填写 base URL、API key，以及一个或多个 model ID。
6. 运行内置测试请求。
7. 保存配置后，模型会出现在模型选择器中。

自定义模型设置会保存在本地。请不要提交 API keys、本地认证文件、生成配置或机器专属签名设置。

## 快速开始

安装依赖：

```sh
npm install
```

仅运行前端开发服务：

```sh
npm run dev
```

启动完整 Tauri 桌面应用：

```sh
npm run tauri:dev
```

桌面构建前运行严格环境检查：

```sh
npm run doctor:strict
```

## 开发命令

```sh
npm run build
npm run lint
npm run test
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

针对 Rust/Tauri 的聚焦验证：

```sh
cd src-tauri
cargo check
cargo test
```

## 功能范围

- 支持工作区上下文的聊天线程、文件引用和 token 感知自动补全。
- 文件预览、终端面板、分支工具、Git diff 和面向 PR 的审查上下文。
- 兼容 Responses 和 Messages 端点的模型/API key 管理。
- Skills、plugins、prompt 管理和 MCP server 状态界面。
- 全局与工作区级 `AGENTS.md` 指令的本地编辑器。
- 从桌面 UI 编辑 Codex `config.toml`。
- 多语言 UI 资源，以及中英文 README 文档。

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

## 配置说明

OpenLadonx 会读取和写入本地桌面设置、Codex 配置以及工作区指令文件。常见本地配置包括：

- API keys 与 base URLs。
- 自定义 Responses API 和 Messages API 模型列表。
- 全局和工作区 `AGENTS.md` 指令。
- Codex `config.toml` 内容。
- 由底层 agent 环境管理的插件启用状态和 MCP 配置。

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
