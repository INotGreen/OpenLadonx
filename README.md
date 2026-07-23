# OpenLadonx

[English](README.md) | [简体中文](README.zh-CN.md)

![Version](https://img.shields.io/badge/version-0.7.68-blue)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
![React](https://img.shields.io/badge/React-19-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6)
![License](https://img.shields.io/badge/license-see%20LICENSE-lightgrey)

OpenLadonx is a native AI coding workspace for Codex-style agent workflows. It brings chat threads, workspace context, git review, terminals, model routing, skills, plugins, MCP server status, and local desktop integrations into one Tauri app.

Use the built-in provider path, or connect your own OpenAI Responses-compatible and Anthropic Messages-compatible model endpoints. OpenLadonx is designed for teams and power users who want a local-first agent cockpit instead of yet another browser tab.

![OpenLadonx proxy architecture](assets/flow.png)

## Why OpenLadonx

- **One desktop cockpit** for agent conversations, workspaces, files, terminals, diffs, branches, issues, and pull requests.
- **Bring your own models** through OpenAI Responses-compatible `/v1/responses` endpoints or Anthropic Messages-compatible `/v1/messages` endpoints.
- **Native workflow surfaces** powered by Tauri 2, Rust, React 19, TypeScript, Vite, and local filesystem integration.
- **Extensible agent environment** with skills, plugins, prompts, MCP tool-call rendering, and workspace `AGENTS.md` editing.
- **Local configuration control** for model credentials, Codex `config.toml`, plugin state, MCP status, and desktop settings.

## Model Routing

OpenLadonx supports two custom API protocol families from Settings:

| Protocol | Endpoint style | Typical use |
| --- | --- | --- |
| `OpenAI/Response` | `/v1/responses` | OpenAI Responses-compatible providers, routers, and proxy layers. |
| `Anthropic/Messages` | `/v1/messages` | Anthropic Messages-compatible providers, routers, and Claude-style model surfaces. |

To add a model:

1. Open **Settings**.
2. Go to the model/API key section.
3. Click **Add model**.
4. Choose `OpenAI/Response` or `Anthropic/Messages`.
5. Enter the base URL, API key, and one or more model IDs.
6. Run the built-in test request.
7. Save the configuration. The models will appear in the model selector.

Custom model settings are stored locally. Do not commit API keys, local auth files, generated config, or machine-specific signing settings.

## Quick Start

Install dependencies:

```sh
npm install
```

Run the frontend only:

```sh
npm run dev
```

Launch the full Tauri desktop app:

```sh
npm run tauri:dev
```

Run the strict environment check before desktop builds:

```sh
npm run doctor:strict
```

## Development Commands

```sh
npm run build
npm run lint
npm run test
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

For focused Rust/Tauri validation:

```sh
cd src-tauri
cargo check
cargo test
```

## Feature Surface

- Workspace-aware chat threads with file references and token-aware autocomplete.
- File previews, terminal panes, branch helpers, git diffs, and PR-oriented review context.
- Model/API key management for compatible Responses and Messages endpoints.
- Skills, plugins, prompt management, and MCP server status surfaces.
- Local editors for global and workspace-level `AGENTS.md` instructions.
- Codex `config.toml` editing from the desktop UI.
- Multi-language UI assets and English/Chinese README documentation.

## Project Layout

```text
.
├── public/              # Static web assets
├── src/                 # React application code
│   ├── features/        # Feature modules
│   ├── hooks/           # Shared React hooks
│   ├── services/        # App and Tauri service clients
│   ├── styles/          # Global and design-system styles
│   ├── test/            # Vitest setup
│   └── utils/           # Shared helpers
├── src-tauri/           # Tauri configuration and Rust code
│   ├── src/             # Rust commands, services, and app wiring
│   └── tests/           # Rust integration tests
├── scripts/             # Build, doctor, release, and maintenance scripts
└── docs/                # Project documentation and static docs site
```

## Prerequisites

- Node.js and npm.
- Rust toolchain with Cargo.
- Tauri system dependencies for your platform.
- A model credential from a supported default provider, or a compatible custom endpoint.

## Configuration

OpenLadonx reads and writes local desktop settings, Codex configuration, and workspace instruction files. Typical local configuration includes:

- API keys and base URLs.
- Custom Responses API and Messages API model lists.
- Global and workspace `AGENTS.md` instructions.
- Codex `config.toml` content.
- Plugin enablement and MCP configuration managed by the underlying agent environment.

The repository includes `.testflight.local.env.example` as a reference for local release configuration. Copy it to an ignored local file when needed.

## Contributing

- Use 2-space indentation for TypeScript and TSX.
- Name React components in `PascalCase`, hooks as `useSomething`, utilities in `camelCase`, and Rust functions in `snake_case`.
- Prefer configured aliases such as `@/`, `@app/`, `@services/`, and `@utils/`.
- Keep frontend IPC contracts aligned with Rust Tauri commands and payload types.
- Add focused tests near the feature or module you change.
- Run `npm run typecheck`, `npm run lint`, and relevant tests before opening a pull request.

## License

This project is licensed under the terms in [LICENSE](LICENSE).
