# Repo Infrastructure Plan

Status: completed

This plan supersedes the previous generated execution plan, which had stale unchecked boxes after implementation landed.

## Completed

- Added root `prepare` script for Husky.
- Added `husky` and `lint-staged` dev dependencies.
- Added staged-file `lint-staged` config for TypeScript, JSON, and Markdown.
- Added `.husky/pre-commit` to run `bunx lint-staged`.
- Added `.husky/pre-push` to run `bun run test`.
- Added split pull request CI in `.github/workflows/pr-ci.yml`.
- Updated main branch CI in `.github/workflows/ci.yml`.
- Added `.github/pull_request_template.md`.
- Added `.github/ISSUE_TEMPLATE/config.yml` contributor contact link.

## Verification

Use:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

The current behavior is documented in [.docs/repo-infrastructure.md](../.docs/repo-infrastructure.md).
