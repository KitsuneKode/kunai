# Plan 005: Move ink's transitive `ws` past the high-severity advisory

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- bun.lock package.json`
> If `bun.lock` changed, re-run `bun audit` and re-read the current `ws` pin before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: migration (dependency security)
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

`bun audit` reports a **high** advisory (GHSA-96hv-2xvq-fx4p, a DoS) affecting `ws >=8.0.0 <8.21.0`, reached through the shipped CLI's dependency tree via `ink`. The lockfile currently resolves `ws@8.20.1` — inside the vulnerable range. `ink@7.1.0` already declares `ws@^8.20.0`, so `8.21.x` satisfies it: this is a lockfile bump, not a code change. It's the one advisory that reaches distributable runtime code (the others `bun audit` lists — postcss, esbuild, js-yaml — are docs/build-path only and out of scope here).

## Current state

- `bun.lock:1395`: `"ws": ["ws@8.20.1", …]` — the vulnerable pin.
- `bun.lock:953`: `ink@7.1.0` depends on `"ws": "^8.20.0"`.
- Root `package.json` has an `overrides` block (currently for `@types/node`, `fumadocs-*`, `lucide-react`) — the mechanism to force a transitive version if `bun update` alone doesn't move it.

Repo conventions: Bun workspace (`bun@1.3.14`), catalogs in root `package.json`, conventional commits (`chore(deps): …` or `fix(deps): …`).

## Commands you will need

| Purpose        | Command                       | Expected                       |
| -------------- | ----------------------------- | ------------------------------ |
| Audit (before) | `bun audit`                   | shows the high `ws` advisory   |
| Update ws      | `bun update ws`               | lockfile changes ws to ≥8.21.0 |
| Audit (after)  | `bun audit`                   | no high `ws` advisory          |
| Typecheck      | `bun run typecheck`           | exit 0                         |
| CLI tests      | `bun run --cwd apps/cli test` | pass                           |
| Build binary   | `bun run build:binary:host`   | exit 0                         |

## Scope

**In scope**:

- `bun.lock`
- `package.json` (only if an `overrides` entry for `ws` is required)

**Out of scope**:

- The docs-path advisories (postcss, esbuild, js-yaml via `apps/docs`/changesets) — separate, lower priority; do not touch `apps/docs` here.
- Upgrading `ink` itself — not needed and higher risk.

## Git workflow

- Branch: `advisor/005-ws-advisory-bump`
- Commit: `fix(deps): bump transitive ws past GHSA-96hv-2xvq-fx4p (DoS)`

## Steps

### Step 1: Confirm the advisory

Run `bun audit`. Confirm a **high** `ws` advisory reached via `ink`. If it is already gone (lockfile drifted and someone fixed it), STOP and mark the plan REJECTED in the index with "already resolved".

### Step 2: Bump ws

Run `bun update ws`. Inspect `git diff bun.lock` and confirm the `ws` entry is now `>=8.21.0`.

If `bun update ws` does not move it (some resolvers pin transitives), add to root `package.json` `overrides`:

```json
"overrides": {
  "@types/node": "catalog:",
  "fumadocs-core": "catalog:web",
  "fumadocs-ui": "catalog:web",
  "lucide-react": "catalog:web",
  "ws": "^8.21.0"
}
```

then run `bun install` and re-check.

**Verify**: `grep -n '"ws@8' bun.lock` shows only `8.21.x` (or newer); `bun audit` no longer lists the high `ws` advisory.

### Step 3: Confirm nothing broke

The CLI uses `ink` for the whole TUI; `ws` is a transitive of ink's dev/inspector path. Confirm the app still typechecks, tests pass, and the binary builds.

**Verify**: `bun run typecheck && bun run --cwd apps/cli test && bun run build:binary:host` → all exit 0.

## Done criteria

- [ ] `bun audit` shows no high-severity `ws` advisory
- [ ] `bun.lock` resolves `ws` to ≥8.21.0
- [ ] `bun run typecheck` exits 0; `bun run --cwd apps/cli test` passes; host binary builds
- [ ] Only `bun.lock` (and optionally `package.json` overrides) changed; `plans/README.md` row updated

## STOP conditions

- `bun update ws` pulls a **major** ws version (9.x) that ink does not accept — pin to `^8.21.0` via overrides instead of accepting a major bump.
- The binary build fails after the bump — report the error; do not force-downgrade back into the advisory.

## Maintenance notes

- Revisit when `ink` releases a version that pins ws ≥8.21 itself, then the override can be removed.
- The docs-path advisories are tracked separately — consider a follow-up plan for `apps/docs` if those ever reach a shipped surface.
