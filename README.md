# OpenLadonx

[English](README.md) | [简体中文](README.zh-CN.md)

OpenLadonx is a desktop AI coding workspace built with React, Vite, TypeScript, and Tauri 2. It wraps Codex-style agent workflows in a native app: workspace management, threaded conversations, git review tools, terminal panels, model configuration, skills, plugins, MCP server status, and local desktop integrations live in one place.

The project is designed for people who want a local-first agent cockpit rather than another browser tab. You can use the default model credentials, or add your own compatible model endpoints for OpenAI Responses-style APIs and Anthropic Messages-style APIs.

## Highlights

- Native desktop shell powered by Tauri 2 and Rust.
- React 19 + TypeScript frontend with Vite.
- Workspace-aware chat threads, file previews, terminal panes, git diffs, branch tools, and PR helpers.
- Custom model configuration for compatible `/v1/responses` and `/v1/messages` endpoints.
- Skills, plugins, prompts, and file-token autocomplete in the composer.
- MCP-related tool call rendering and MCP server status surfaces.
- Local settings editors for `AGENTS.md` and Codex `config.toml`.
- Multi-language UI assets and README documentation.

## Model Support

OpenLadonx supports two custom API protocol families:

| Protocol in Settings | Expected endpoint style | Use case |
| --- | --- | --- |
| `OpenAI/Response` | `/v1/responses` | OpenAI Responses-compatible providers and routers. |
| `Anthropic/Messages` | `/v1/messages` | Anthropic Messages-compatible providers and routers. |

To add a model:

1. Open **Settings**.
2. Go to the model/API key section.
3. Click **Add model**.
4. Choose `OpenAI/Response` or `Anthropic/Messages`.
5. Enter the base URL, API key, and one or more model IDs.
6. Run the built-in test request.
7. Save the configuration. The models will appear in the model selector.

The app stores custom model settings locally and switches to local custom API configuration after you save a custom model. Do not commit local keys or generated config files.

## External Tools

OpenLadonx is built around extensible agent workflows:

- **Skills**: discover and use skill instructions in the composer and thread flow.
- **Plugins**: list configured plugins, browse plugin marketplace entries, install plugins, and uninstall them from the app.
- **MCP**: display MCP tool calls in threads and inspect MCP server status for a workspace.
- **Prompts and AGENTS.md**: edit global and workspace-level instructions from the desktop UI.
- **GitHub and git tooling**: inspect repository status, branches, commits, diffs, issues, pull requests, and review context.

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
- A model credential from a supported default provider or a compatible custom endpoint.

Run the strict doctor check before desktop builds to catch missing native dependencies:

```sh
npm run doctor:strict
```

## Getting Started

Install JavaScript dependencies:

```sh
npm install
```

Start the Vite frontend only:

```sh
npm run dev
```

Launch the full Tauri desktop app:

```sh
npm run tauri:dev
```

## Development Commands

```sh
npm run build
npm run lint
npm run test
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

For Rust changes, run focused Cargo checks or tests from `src-tauri/` when practical:

```sh
cd src-tauri
cargo check
cargo test
```

## Configuration Notes

OpenLadonx reads and writes local desktop settings, Codex configuration, and workspace instruction files. Typical local configuration includes:

- API key and base URL values.
- Custom Response API and Messages API model lists.
- Global `AGENTS.md` instructions.
- Codex `config.toml` content.
- Plugin enablement and MCP configuration managed by the underlying agent environment.

Do not commit API keys, tokens, signing settings, generated bundles, local auth files, or machine-specific configuration. The `.gitignore` excludes common build output and local credential files such as `src-tauri/ladonx_auth.json`.

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
