# Roadmap

This roadmap is public and intentionally practical. It favors correctness, safe Git behavior, and distributable desktop quality over adding broad features too early.

## Now

- Harden guided handoff workflows between local workspace and worktrees.
- Expand Git correctness around ahead/behind, dirty state, stashes, detached branches, and remotes.
- Improve accessibility, keyboard navigation, and PT/EN i18n coverage.
- Keep visual E2E coverage current with key screens.
- Maintain cross-platform CI/release workflows and document packaging gaps.

## Next

- Finish native Tauri/Rust Git command migration for production desktop builds.
- Add native Windows/macOS code signing on top of the current attestation pipeline.
- Validate Linux packages after the desktop backend strategy is stable.
- Add updater support with signed artifacts.
- Add release notes automation and checksum publishing.
- Expand integration support for editors, terminals, and repository hosting providers.

## Later

- Repository health dashboard and stale worktree cleanup suggestions.
- Optional remote provider integrations for pull requests and CI status.
- Team-shareable workflow presets.
- Plugin-style extension points for custom Git workflows.
- Full translation coverage beyond the current PT/EN foundation.

## Release Blockers For A Public Stable Release

- Final desktop backend strategy: native Rust commands or packaged sidecar.
- Signed installers for Windows and macOS.
- Final app icon and brand assets.
- Security review of Git command allowlists and path handling.
- Clear privacy statement for diagnostics and local state.
- Documentation review by a first-time contributor.
