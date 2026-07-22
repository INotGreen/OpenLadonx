# OpenLadonx

OpenLadonx is the desktop client for LadonX, built with React, Vite, TypeScript, and Tauri 2. The app combines a modern React workspace with a Rust native layer for desktop integration, local services, packaging, and system-level workflows.

## Features

- React 19 + TypeScript frontend powered by Vite.
- Tauri 2 native shell with Rust commands and desktop packaging.
- Feature-oriented source layout under `src/features`.
- Shared services, hooks, utilities, and design-system styles.
- Vitest, ESLint, and TypeScript checks for frontend validation.
- Rust validation through Cargo for the Tauri layer.

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
├── scripts/             # Build, doctor, and maintenance scripts
└── docs/                # Project documentation and static docs site
```

## Prerequisites

- Node.js and npm.
- Rust toolchain with Cargo.
- Tauri system dependencies for your platform.

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

## Configuration

Do not commit API keys, tokens, signing settings, generated bundles, or local machine configuration. Use environment variables or local ignored files for provider keys and platform-specific settings.

The repository includes `.testflight.local.env.example` as a reference for local release configuration. Copy it to an ignored local file when needed.

## Contributing

- Use 2-space indentation for TypeScript and TSX.
- Name React components in `PascalCase`, hooks as `useSomething`, utilities in `camelCase`, and Rust functions in `snake_case`.
- Prefer configured aliases such as `@/`, `@app/`, `@services/`, and `@utils/`.
- Keep frontend IPC contracts aligned with Rust Tauri commands and payload types.
- Add focused tests near the feature or module you change.

## License

This project is licensed under the terms in [LICENSE](LICENSE).
