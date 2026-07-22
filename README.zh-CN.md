# OpenLadonx

[English](README.md) | [简体中文](README.zh-CN.md)

OpenLadonx 是 LadonX 的桌面客户端，基于 React、Vite、TypeScript 和 Tauri 2 构建。它将现代 React 工作区与 Rust 原生层结合，用于桌面集成、本地服务、应用打包以及系统级工作流。

## 功能特性

- 基于 Vite 的 React 19 + TypeScript 前端。
- Tauri 2 原生桌面外壳，包含 Rust 命令与桌面打包能力。
- 按功能组织的源码结构，核心功能位于 `src/features`。
- 提供共享的 services、hooks、utils 与设计系统样式。
- 使用 Vitest、ESLint 和 TypeScript 进行前端校验。
- 使用 Cargo 校验 Tauri/Rust 原生层。

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
├── scripts/             # 构建、doctor 与维护脚本
└── docs/                # 项目文档与静态文档站点
```

## 环境要求

- Node.js 与 npm。
- Rust 工具链与 Cargo。
- 当前平台所需的 Tauri 系统依赖。

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

## 配置说明

不要提交 API keys、tokens、签名配置、生成产物或本机专属配置。服务商密钥和平台相关设置应放在环境变量或本地忽略文件中。

仓库提供 `.testflight.local.env.example` 作为本地发布配置参考。需要时可复制为被忽略的本地配置文件。

## 贡献指南

- TypeScript 和 TSX 使用 2 空格缩进。
- React 组件使用 `PascalCase`，hooks 使用 `useSomething`，工具函数使用 `camelCase`，Rust 函数使用 `snake_case`。
- 优先使用已配置的路径别名，例如 `@/`、`@app/`、`@services/` 和 `@utils/`。
- 前端 IPC 契约需要与 Rust Tauri 命令和载荷类型保持同步。
- 修改功能或模块时，请添加聚焦的测试。

## 许可证

本项目使用 [LICENSE](LICENSE) 中声明的许可证。
