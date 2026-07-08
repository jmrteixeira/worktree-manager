# Security Policy

Worktree Manager is a local developer tool that runs Git and filesystem operations on the user's machine. Security reports are taken seriously, especially issues that could execute unexpected commands, access unintended paths, or weaken confirmation flows.

The app does not implement remote telemetry. Diagnostics and operation logs are local unless the user explicitly copies or shares them.

## Supported Versions

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Packaged releases | Best effort until a stable release policy exists |

## Reporting A Vulnerability

Please do not open a public issue for vulnerabilities.

Use GitHub private vulnerability reporting for this repository. If that is unavailable, contact a maintainer privately before publishing details.

Please include:

- A concise description of the issue.
- Steps to reproduce.
- Impact and affected platforms.
- Whether a malicious repository, branch name, path, or remote is required.
- Logs or screenshots with secrets and private paths redacted.

## Security Expectations

- Git commands must use separated arguments, not shell interpolation.
- User-controlled paths and branch names must be validated before sensitive operations.
- Destructive actions must require explicit confirmation.
- Local API endpoints must remain scoped to local use.
- Diagnostics should avoid exposing secrets.
- Any future telemetry must be opt-in, off by default, documented, and auditable.

## Disclosure

Maintainers will acknowledge valid reports as soon as practical, coordinate a fix, and publish release notes once users have a safe upgrade path.
