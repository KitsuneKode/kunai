# Plan 063: Dependency hygiene — clear the advisories, floor the install, watch it weekly

> **Drift check (run first):** `bun audit` — output changes as advisories land and deps bump. If the list is empty or grew, re-derive the "Current state" table instead of trusting it.
> Also: `git diff --stat 51f19b633..HEAD -- bun.lock package.json apps/docs/package.json bunfig.toml .github/workflows/`

Found during the audit-2 S6 distribution sweep (which the ledger never closed).

## Status

- **Priority:** P2
- **Effort:** S
- **Risk:** LOW — advisory deps live in the docs workspace and release tooling, not the shipped CLI
- **Depends on:** none
- **Category:** security / dependency hygiene
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`bun audit` at `51f19b633` reports **14 advisories (8 high)**. None are
reachable from the published CLI — every path resolves through
`workspace:@kunai/docs` (`shadcn`, `next`) or the dev-only `@changesets/cli` —
but the docs site is a deployed surface and dev machines run the toolchain
daily.

The deeper issue is that nothing watches this. There is no dependabot, no
renovate, no scheduled audit — advisories accumulate until someone happens to
run the command. Meanwhile CI pins every Action to a SHA and gates release
provenance, so the *release* supply chain is locked down while the *install*
supply chain accepts a package published 30 seconds ago. The outcome this plan
is buying: advisories get fixed once, then a weekly job surfaces new ones
before they pile up, and a release-age floor blunts the fresh-publish attack
window entirely.

## Current state

| Package | Severity | Fix version | Reachable via |
|---|---|---|---|
| fast-uri | high ×4 | ≥3.1.6 | `apps/docs > shadcn > @modelcontextprotocol/sdk > ajv` |
| browserslist | high ×2 | >4.28.6 | `apps/docs > shadcn` |
| js-yaml | high ×2 | ≥4.3.2 / ≥3.15.2 | `shadcn > cosmiconfig`; `@changesets/cli > @manypkg/get-packages > read-yaml-file` |
| hono | moderate ×3 | ≥4.13.5 | `mcp-sdk > @hono/node-server` |
| qs | moderate ×2 | ≥6.16.0 | `mcp-sdk > express > body-parser` |
| baseline-browser-mapping | moderate | ≥2.11.0 | `next`; `shadcn > browserslist` |

No `bunfig.toml` exists at root (verified absent) — `bun install` has no
`minimumReleaseAge` guard despite the pinned-CI posture. No dependabot or
renovate config exists. Scheduled workflows are already the repo's convention:
`installer-matrix` runs daily, `provider-matrix`/`build-binaries` run Mondays —
a weekly audit job fits that pattern exactly.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Repro | `bun audit` | lists the table above |
| Fix pass | `bun audit fix` then re-run `bun audit` | count drops; 0 ideal |
| Remaining fixes | `bun update <pkg>` in the owning workspace, or a targeted `overrides` entry when a parent range pins an old major | audit clean |
| Docs sanity | `bun run --cwd apps/docs build` | exits 0 |
| Full gates | `bun run typecheck --force && bun run test --force` | exit 0 |

## Scope

**In scope:**
- `bun.lock` (regenerated), `apps/docs/package.json` + root `package.json` if
  overrides/ranges must move
- New `bunfig.toml` with `[install] minimumReleaseAge`
- New `.github/workflows/dep-audit.yml` — weekly, non-blocking
- `.docs/repo-infrastructure.md` — document the floor and the job

**Out of scope:**
- Making `bun audit` a blocking PR gate — advisory feeds flap; a red gate that
  fails on a *newly disclosed* vuln in a pinned lockfile trains people to
  ignore it. Scheduled + informational is the right shape.
- Upgrading `next`/`shadcn`/`@changesets/cli` themselves for features — only
  as far as advisory fixes require.
- dependabot/renovate adoption — a bigger decision (noise vs. coverage) that a
  maintainer should take knowingly; the weekly job covers the gap meanwhile.

## Steps

### Step 1: Land the release-age floor first

Create `bunfig.toml` at the root:

```toml
[install]
# Newly published packages bake for a week before bun install will resolve
# them. Supply-chain packages are usually caught and yanked inside days.
minimumReleaseAge = 604800
```

Then `bun install` to confirm the pinned `bun@1.4.0` honors the key and the
lockfile still resolves (all current deps are far older than 7 days). If the
key is rejected, drop this section and record why in the PR body — do not ship
an unknown-key warning as a fix. If a future urgent patch needs a fresher
version, `minimumReleaseAgeExclude` is the documented escape hatch — mention
it in the docs note.

### Step 2: Clear the advisories

Run `bun audit fix`. For any advisory that survives (a parent range pins the
vulnerable major — most likely the mcp-sdk→express→qs chain), bump the
smallest owning package in `apps/docs/package.json` / root devDeps, or add a
targeted `overrides` entry in the root `package.json`. Prefer updating the
direct dep over an override; an override is the fallback, not the default, and
needs a comment naming the advisory id.

### Step 3: Verify the docs workspace still works

`bun run --cwd apps/docs build` plus docs typecheck. The vulnerable code paths
(toSSG, body parsing, yaml merge keys) are not exercised by the build, so a
green build plus a clean audit is the bar — no exploit repro needed.

### Step 4: Watch it weekly

Add `.github/workflows/dep-audit.yml`, scheduled Mondays alongside the other
maintenance jobs (`cron: "30 6 * * 1"` to avoid the existing 6:00/6:15 slot),
plus `workflow_dispatch`. Job shape: checkout, setup bun, `bun install
--frozen-lockfile`, `bun audit --json` → write the report to the workflow
summary and upload it as an artifact. Exit 0 either way — informational only.
Do **not** have it open issues automatically; a noisy auto-filed issue is how
these jobs get deleted.

### Step 5: Document

One paragraph in `.docs/repo-infrastructure.md`: `bunfig.toml` floors package
freshness at 7 days; `dep-audit.yml` posts a weekly advisory report;
overrides need an advisory-id comment.

## Test plan

- `bun audit` exits 0, or every remaining advisory is recorded in the PR body
  with the blocking range named.
- `bun run --cwd apps/docs build` + `bun run typecheck --force` pass.
- `bun install --frozen-lockfile` succeeds (proves the lockfile round-trips
  under the new floor).
- Trigger the workflow manually (`workflow_dispatch`) and confirm the summary
  renders.

## Done criteria

- [ ] `bunfig.toml` exists with `minimumReleaseAge` (or a recorded reason it
  cannot ship)
- [ ] `bun audit` is clean, or remaining items are waived with the blocking
  range named
- [ ] `dep-audit.yml` runs weekly and posts a readable summary
- [ ] Docs build and full gates pass
- [ ] `repo-infrastructure.md` documents the floor and the job

## STOP conditions

- `bun audit` output differs substantially — re-derive the table; advisories
  churn faster than plans.
- A fix requires a major bump of `next`, `shadcn`, or `@changesets/cli` that
  breaks the docs build — land what is safe, waive the rest with the blocker
  named, do not silently expand scope into a framework upgrade.
- `minimumReleaseAge` turns out to break CI install paths (cold caches,
  freshly-published internal packages) — the fix is `minimumReleaseAgeExclude`
  for the internal names, not removing the floor.

## Maintenance notes

- If a maintainer later adopts dependabot/renovate, this plan's workflow can
  be deleted — the floor stays valuable either way.
