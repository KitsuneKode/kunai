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

## Workspace Dependencies

The monorepo uses [Bun catalogs](https://bun.sh/docs/pm/catalogs) in the root
`package.json` to pin shared versions once:

- `catalog:` — TypeScript 7, React, React DOM, `@types/*`, Zod
- `catalog:cli` — `commander`, `ink` (CLI runtime)
- `catalog:lint` — `oxlint`, `oxfmt` (root only; turbo package scripts +
  lint-staged resolve them via workspace hoist)
- `catalog:providers` — `@assemblyscript/loader`, `crypto-js`, `@types/crypto-js`
- `catalog:repo` — `turbo` (root orchestration only)
- `catalog:web` — Next.js, Fumadocs, Tailwind, Motion, Base UI, Tabler icons,
  docs UI helpers, and docs TypeScript 5.9 (`apps/docs` only)

Prefer npm `latest` (stable) pins in catalogs — not `canary`, `preview`, `rc`,
or `next` tags.

Root `overrides` dedupe known transitive drift (`@types/node`, `fumadocs-core`,
`fumadocs-ui`). Fumadocs still pulls Radix + `lucide-react` transitively; do not
re-catalog those as direct docs deps — docs UI uses Base UI + Tabler.

`apps/experiments` is **outside** the default workspace, so it cannot use
`catalog:` protocols. Main installs stay lean; research deps install only via
`bun run experiments:install` (standalone `apps/experiments/bun.lock`).

Default workspace packages: `apps/cli`, `apps/docs`, `apps/relay-server`,
`apps/telemetry-ingest`, `packages/*`.

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

Pull requests and pushes to `main` use the composite setup action
[`.github/actions/setup-bun-monorepo`](../.github/actions/setup-bun-monorepo/action.yml):
Bun store cache, per-job `.turbo` cache prefixes, `TURBO_SCM_BASE` on PRs, and
`TURBO_TOKEN` / `TURBO_TEAM` for remote Turbo cache.

### Checkout is caller-owned

**Every job must run `actions/checkout` before it uses a local composite
action.** The composite deliberately does not check out.

A local composite (`uses: ./.github/actions/...`) is loaded from the workspace,
so GitHub can only resolve it once the repository is already on disk. If the
composite performs the checkout itself, a job whose first step is that composite
fails while trying to _find_ the action — before the checkout inside it can run.

This broke the release pipeline silently: the composite carried its own
checkout, `release.yml` had none of its own, and from 2026-06-27 the release job
never reached publish. Version 0.2.6 has a version bump and release notes but no
`v0.2.6` tag and no published binaries, while every local gate stayed green —
local runs never execute workflow bootstrap.

The invariant is enforced two ways:

- `bun run scripts/ci-bootstrap-contract.ts` — exits non-zero listing any
  composite that checks out, or any local-composite use not preceded by a
  checkout in the same job.
- `apps/cli/test/unit/scripts/ci-bootstrap-contract.test.ts` — the same rule in
  the default test path, so a regression fails CI rather than the next release.

**Parallel jobs** (`.github/workflows/ci.yml`):

| Job              | PR                                                                                    | Main         |
| ---------------- | ------------------------------------------------------------------------------------- | ------------ |
| `fmt`            | `turbo run fmt:check --affected`                                                      | full         |
| `lint`           | `turbo run lint --affected`                                                           | full         |
| `typecheck`      | `turbo run typecheck --affected`                                                      | full         |
| `test`           | `turbo run test --affected` (CLI splits into cached `test:unit` + `test:integration`) | full         |
| `windows-cli`    | root typecheck + CLI tests when CLI paths change                                      | same on main |
| `build-cli`      | `bun run build` + `bun run pkg:check` when CLI paths change                           | same on main |
| `build-binaries` | 2 Linux targets via Turbo when CLI/installer paths change                             | same         |
| `checks-docs`    | docs gate when docs paths change                                                      | same         |

Install cache key: `${{ runner.os }}-bun-store-${{ hashFiles('bun.lock') }}` covering
`~/.bun/install/cache` only (Bun reconstructs `node_modules` from the store).

**Build tasks** (Turbo):

- `build` — npm bundle (`dist/kunai.js`, `dist/assets/**`)
- `build:binary:host` — host compiled binary (`dist/bin/kunai-*`)
- `build:binaries` — release cross-compiles (`dist/bin/**`)

`bun run build` at the repo root runs `build` + `build:binary:host` in parallel.
Compiled binaries never ship on npm; `pkg:check` enforces an allowlist and size budget.

### Windows parity

`windows-cli` is an intentionally non-blocking `windows-latest` signal. It runs the
workspace typecheck and the CLI unit/integration suite, including a Windows-only
assertion for the mpv named-pipe endpoint. It becomes a required check only when:

- a native mpv named-pipe smoke test exercises connect, command, and close;
- the first Windows runs have no remaining platform-specific failures; and
- the backlog below is empty.

Open Windows parity backlog:

- Add a native mpv named-pipe smoke; the current test locks endpoint construction,
  but does not launch mpv or prove `Bun.connect` interoperability.
- Add Windows compiled-binary build and smoke coverage; the parity leg currently
  validates source execution only.

**Local pipeline verification**

```sh
bun run verify:build-pipeline       # fast: build + pkg:check + turbo cache
bun run verify:build-pipeline:pr    # PR parity: + 2 Linux binaries
KUNAI_VERIFY_ALL_BINARIES=1 bun run verify:build-pipeline:all-targets  # opt-in 8-target build
```

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
