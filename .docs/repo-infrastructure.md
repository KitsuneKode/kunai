# Kunai — Repo Infrastructure

This is the canonical reference for local developer guardrails and GitHub CI.

## Current State

Repo infrastructure from the May 2026 superpowers plan is implemented.

| Area                      | Canonical location                    | Status      |
| ------------------------- | ------------------------------------- | ----------- |
| Pull request + main CI    | `.github/workflows/ci.yml`            | Implemented |
| Release workflow          | `.github/workflows/release.yml`       | Implemented |
| Release guard (PR/main)   | `.github/workflows/release-guard.yml` | Implemented |
| Release guard script      | `scripts/release-guard.ts`            | Implemented |
| Root changelog sync       | `scripts/sync-root-changelog.ts`      | Implemented |
| Pre-commit hook           | `.husky/pre-commit`                   | Implemented |
| Pre-push hook             | `.husky/pre-push`                     | Implemented |
| Staged formatting/linting | root `package.json` `lint-staged`     | Implemented |
| PR template               | `.github/pull_request_template.md`    | Implemented |
| Issue template config     | `.github/ISSUE_TEMPLATE/config.yml`   | Implemented |

## Local Hooks

`bun install` runs the root `prepare` script and installs Husky hooks.

The pre-commit hook runs staged-file lint/format only:

```sh
bunx lint-staged
```

When release-related files change (`apps/cli/package.json`, `apps/cli/CHANGELOG.md`,
root `CHANGELOG.md`, or `.changeset/*.md`), lint-staged also runs `bun run guard` to
catch version/changelog drift before commit.

The pre-push hook runs the full workspace test command:

```sh
bun run test
```

## CI

Pull requests and pushes to `main` run:

```sh
bun run ci
bun run build
bun run build:docs
bun run pkg:check
```

`TURBO_TOKEN` and `TURBO_TEAM` are exposed from repo secrets for optional Turborepo remote caching.

## Release guardrails

Release workflow details live in [RELEASING.md](../RELEASING.md). Infrastructure touchpoints:

- `bun run guard` — local version ↔ changelog consistency check
- `.github/workflows/release-guard.yml` — runs `bun run guard` on PRs that touch `apps/cli/**`, `.changeset/**`, or release scripts
- `.github/workflows/release.yml` — version/publish pipeline (scoped paths; runs guard before publish)
- Changelog parser tests: `apps/cli/test/unit/scripts/release-changelog.test.ts`

## Out Of Scope

- Branch protection configuration lives in GitHub settings.
- Binary publishing is tracked separately in packaging/release plans.
- Typecheck does not run in pre-commit; it belongs in CI and pre-push/full local verification.
