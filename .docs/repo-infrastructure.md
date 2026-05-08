# Kunai — Repo Infrastructure

This is the canonical reference for local developer guardrails and GitHub CI.

## Current State

Repo infrastructure from the May 2026 superpowers plan is implemented.

| Area                      | Canonical location                  | Status                      |
| ------------------------- | ----------------------------------- | --------------------------- |
| Pull request CI           | `.github/workflows/pr-ci.yml`       | Implemented                 |
| Main branch CI            | `.github/workflows/ci.yml`          | Implemented                 |
| Release workflow          | `.github/workflows/release.yml`     | Existing workflow preserved |
| Pre-commit hook           | `.husky/pre-commit`                 | Implemented                 |
| Pre-push hook             | `.husky/pre-push`                   | Implemented                 |
| Staged formatting/linting | root `package.json` `lint-staged`   | Implemented                 |
| PR template               | `.github/pull_request_template.md`  | Implemented                 |
| Issue template config     | `.github/ISSUE_TEMPLATE/config.yml` | Implemented                 |

## Local Hooks

`bun install` runs the root `prepare` script and installs Husky hooks.

The pre-commit hook runs staged-file lint/format only:

```sh
bunx lint-staged
```

The pre-push hook runs the full workspace test command:

```sh
bun run test
```

## CI

PR CI splits the expensive checks into parallel jobs:

- `bun run typecheck`
- `bun run lint`
- `bun run fmt:check`
- `bun run test`

The build job runs only after all four checks pass.

Main branch CI keeps the same gate sequential:

```sh
bun run ci
bun run build
```

Both workflows expose `TURBO_TOKEN` and `TURBO_TEAM` from repo secrets for optional Turborepo remote caching.

## Out Of Scope

- Branch protection configuration lives in GitHub settings.
- Binary publishing is tracked separately in packaging/release plans.
- Typecheck does not run in pre-commit; it belongs in CI and pre-push/full local verification.
