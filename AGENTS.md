# Repository Guidelines

## Project Structure & Module Organization
This directory is the LadonX desktop client built with React, Vite, and Tauri. Frontend code lives in `src/`: feature areas under `src/features/*`, shared services in `src/services/`, hooks in `src/hooks/`, helpers in `src/utils/`, styles in `src/styles/`, and test setup in `src/test/vitest.setup.ts`. Static assets live in `public/` and `src/assets/`. Native code and packaging live in `src-tauri/`, with Rust sources in `src-tauri/src/`, integration tests in `src-tauri/tests/`, and platform resources in `src-tauri/resources/`.

## Build, Test, and Development Commands
- `npm install`: install dependencies and sync material icons via `postinstall`.
- `npm run dev`: start the Vite frontend only.
- `npm run tauri:dev`: build the Rust daemon, run strict environment checks, and launch the desktop app.
- `npm run build`: run TypeScript compilation and produce a Vite production build.
- `npm run lint`: run ESLint on `.ts` and `.tsx` files.
- `npm run test`: run the Vitest suite once.
- `npm run typecheck`: run `tsc --noEmit`.
- `cargo check --manifest-path src-tauri/Cargo.toml`: validate Rust changes without a full app build.

## Coding Style & Naming Conventions
Use 2-space indentation in TypeScript and TSX. Name React components in `PascalCase`, hooks as `useSomething`, utilities in `camelCase`, and Rust functions in `snake_case`. Prefer configured path aliases such as `@/`, `@app/`, `@services/`, and `@utils/` over deep relative imports. Follow ESLint and TypeScript strictly; this repo also uses lint rules to enforce shared design-system primitives instead of custom modal, panel, toast, and popover shells.

## Testing Guidelines
Frontend tests run with Vitest and Testing Library. Place tests near the feature they cover using `*.test.ts`, `*.test.tsx`, or `*.spec.tsx`. Keep tests focused on user-visible behavior and state transitions. For Rust changes, add or update tests in `src-tauri/tests/` or beside the affected module, then run `cargo test` when practical.

## Commit & Pull Request Guidelines
Recent history uses placeholder subjects, so contributors should use concise imperative commits such as `Fix workspace filter state` or `Add daemon auth test`. Pull requests should explain the change, list validation commands, link related issues, and include screenshots or recordings for UI changes.

## Security & Configuration Tips
Do not commit API keys, tokens, or local machine settings. Run `npm run doctor:strict` before desktop builds to catch missing dependencies and environment drift early.
