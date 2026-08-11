# Plan 018: Add a Windows CI leg to lock in the untested mpv named-pipe path

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done. This is a spike + CI plan —
> land the CI job first, then triage what it surfaces.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- .github/workflows apps/cli/src/infra/player/mpv-ipc-endpoint.ts`
> Mismatch → re-read the workflow + endpoint before editing.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (a Windows job may reveal real gaps — that's the point)
- **Depends on**: none
- **Category**: direction (platform hardening)
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Windows is a claimed-supported platform and its richest playback path — telemetry, skip overlay, bridge script — depends on a named-pipe IPC branch (`//./pipe/kunai-mpv-…` via `Bun.connect`) that has **zero CI coverage**: every workflow runs `ubuntu-latest`. The cross-platform IPC plan says the code landed and the only remaining item is "optional CI on `windows-latest`." A Bun/mpv regression on Windows would ship silently. Adding a Windows CI leg turns the untested branch into a guarded one and surfaces whatever packaging/IPC gaps exist so they become a known backlog instead of a user-reported outage.

## Current state

- `apps/cli/src/infra/player/mpv-ipc-endpoint.ts:35-46`: the Windows branch:

```ts
export function createMpvIpcEndpoint(sessionId: string): MpvIpcEndpoint {
  if (process.platform === "win32") {
    return { kind: "windows_pipe", path: `//./pipe/kunai-mpv-${ipcPipeSuffix(sessionId)}` };
  }
  return { kind: "unix_socket", path: join(unixSocketTempDir(), `kunai-mpv-${sessionId}.sock`) };
}
```

- All CI jobs are `ubuntu-latest` (`.github/workflows/ci.yml` — every `runs-on` is ubuntu; `build-binaries.yml:31` also ubuntu).
- CI already uses `dorny/paths-filter` gating and per-job timeouts (a good model to copy for a non-blocking Windows leg).

Repo conventions: Bun setup in CI, turbo tasks, conventional commits (`ci(...)`).

## Commands you will need

| Purpose        | Command                       | Expected                                            |
| -------------- | ----------------------------- | --------------------------------------------------- |
| Typecheck      | `bun run typecheck`           | exit 0                                              |
| CLI unit tests | `bun run --cwd apps/cli test` | pass (the Windows leg runs these on windows-latest) |
| YAML sanity    | inspect the workflow diff     | valid YAML, job wired                               |

## Scope

**In scope**:

- `.github/workflows/ci.yml` (add a `windows-latest` job) — or a new `.github/workflows/windows.yml` if that's cleaner
- Possibly small platform guards in test setup if a unit test assumes POSIX paths

**Out of scope**:

- Fixing every Windows failure the job surfaces in this plan — capture them as a backlog list; only fix what's trivial and clearly correct.
- The mpv IPC logic itself unless a one-line obvious bug appears.
- Building Windows binaries (separate concern; this leg is typecheck + unit + optionally a compiled-binary smoke).

## Git workflow

- Branch: `advisor/018-windows-ci`
- Commit: `ci(windows): add non-blocking windows-latest typecheck + unit leg`

## Steps

### Step 1: Add the Windows job

Add a job that runs on `windows-latest`: checkout, setup Bun, `bun install`, `bun run typecheck`, `bun run --cwd apps/cli test`. Make it **non-blocking initially** (`continue-on-error: true` or not required for merge) so it reports without blocking PRs while the backlog is worked down — mirror the existing non-blocking provider-matrix workflow pattern (`git log --oneline | grep -i "non-blocking"` points to `ci(live): add non-blocking provider matrix health workflow`).

**Verify**: the workflow YAML is valid and the job appears; if you can trigger CI, the Windows job runs and reports.

### Step 2: Triage what it surfaces

Read the Windows job output. Categorize failures: (a) tests that hardcode POSIX paths/`/tmp` (fix these — they're test bugs), (b) real Windows IPC/packaging gaps (record as a backlog list in the PR description and/or a new `.plans/` note), (c) flakes. Fix only category (a) here.

**Verify**: `bun run --cwd apps/cli test` still passes on Linux after any test-portability fixes.

### Step 3: Decide the promotion path

Document (in the workflow or PR) the criterion for making the Windows leg blocking later (e.g. "once the named-pipe smoke passes and category-(b) backlog is empty"). Do not make it blocking now.

**Verify**: the plan for promotion is written down.

## Done criteria

- [ ] A `windows-latest` job exists running typecheck + CLI unit tests, non-blocking
- [ ] Category-(a) test-portability bugs fixed; Linux CI still green
- [ ] Real Windows gaps captured as an explicit backlog (PR description or a `.plans/` note)
- [ ] Promotion criterion documented
- [ ] `plans/README.md` row updated

## STOP conditions

- Bun setup or `bun install` fails on `windows-latest` in a way that blocks the whole job — report the environment issue; the named-pipe path can't be tested until the toolchain runs there.
- The Windows job reveals the named-pipe IPC is fundamentally broken (not just untested) — that's a real finding; capture it and report rather than trying to fix mpv IPC in this plan.
- Making the job non-blocking isn't supported by the repo's required-checks config — add it as a separate workflow file that isn't in the required set.

## Maintenance notes

- This is the first step of Windows parity, not the finish line. The backlog it produces feeds follow-up plans (named-pipe smoke, Windows binary build).
- Reviewer: confirm the job is genuinely non-blocking so it can't wedge merges while the backlog is open.
- Other direction options from the audit (videasy/vidking decay decision, `--setup` onboarding completion, share-link `/watch` web landing) are deferred — see `plans/README.md` "Deferred direction options."
