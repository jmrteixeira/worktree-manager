# Contributing

Thank you for helping improve Worktree Manager. This project values careful Git behavior, local-first privacy, and UI that helps developers understand exactly what will happen before an operation runs.

## Development Setup

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm test
npm run build
npm run version:check
npm run desktop:check-production
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project Conventions

- Prefer existing local patterns over new abstractions.
- Keep Git command execution explicit, allowlisted, and argument-separated.
- Add pre-confirmation for destructive or branch-moving operations.
- Keep UI copy concise and action-oriented.
- Preserve keyboard navigation, visible focus states, and ARIA labels when adding controls.
- Add tests when touching Git parsing, API contracts, workflows, or sensitive operations.

## Pull Request Checklist

- Explain the user-facing problem and the chosen approach.
- Include screenshots or short recordings for UI changes.
- Add or update tests where behavior changes.
- Run `npm test` and `npm run build`.
- Run `npm run version:check` when changing release metadata.
- Run `npm run desktop:check-production` when touching Tauri, Vite env, or desktop packaging.
- Run Cargo checks when touching `src-tauri/`.
- Update docs when changing setup, packaging, security posture, or workflows.

## Commit Style

Use short, descriptive commit messages. Conventional-style prefixes are welcome:

- `feat: add guided stash workflow`
- `fix: preserve worktree focus after deletion`
- `docs: document Windows installer flow`
- `test: cover branch parser edge cases`

## Reporting Bugs

Use the bug report template and include:

- OS and app mode: web dev, Tauri dev, or packaged desktop.
- Git version.
- Repository/worktree shape, with private paths redacted if needed.
- Expected result, actual result, and relevant operation logs.

## Feature Requests

Feature requests should describe:

- The workflow being improved.
- Why current behavior is not enough.
- Whether the feature touches sensitive Git operations.
- Any comparable workflow in tools like Git CLI, IDEs, or agent worktree managers.
