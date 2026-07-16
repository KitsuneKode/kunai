# Plan 003: Fix three localized correctness bugs (AllManga URL, temp-file deletion, 429 retry)

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm expected output before moving on. On any "STOP conditions" match,
> stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- packages/providers/src/allmanga/direct.ts apps/cli/src/services/download/DownloadService.ts`
> If either changed, compare excerpts to live code; mismatch → STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Three independent, high-confidence bugs, each small and each degrading real user-facing reliability:

1. **One malformed AllManga URL sinks the whole resolve.** An unguarded `new URL(link.url)` inside the resolve try means a single bad/relative link throws and aborts mapping of _all_ other valid streams for that episode, reporting the provider as empty when it had playable sources.
2. **`cleanupOrphanedTempFiles` can delete user data.** It removes any file in the download directory whose name merely _contains_ `.tmp.`, not just Kunai's `<name>.tmp.<uuid>` pattern — so `backup.tmp.old` gets silently deleted on launch.
3. **Transient 429/408 downloads fail permanently.** `analyzeDownloadFailure` classifies any `http error 4xx` as non-retryable, catching rate-limits that should back off and retry.

## Current state

### Bug 1 — `packages/providers/src/allmanga/direct.ts:393`

```ts
sourceEvidence: [
  {
    sourceId,
    nativeLabel: sourceLabel,
    host: link.deferredLocator ? "allanime.day" : new URL(link.url).hostname,  // throws on bad url
    // …
  },
],
```

`link.url` is only truthy-checked earlier (~`:306`), never validated. This runs inside the big resolve `try` whose `catch` (~`:669`) collapses everything to a single `network-error`. Miruro already guards this pattern — see `resolveMiruroPlaybackHost` in `packages/providers/src/miruro/direct.ts:712-719` (the exemplar to match).

### Bug 2 — `apps/cli/src/services/download/DownloadService.ts:1314-1327`

```ts
private cleanupOrphanedTempFiles(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.includes(".tmp.")) {         // too broad — matches any user file
          const fullPath = join(dir, entry.name);
          rmSync(fullPath, { force: true });
        }
      }
    } catch {
      // ignore directory read errors
    }
}
```

Find how Kunai names its temp files (`grep -n "\.tmp\." apps/cli/src/services/download/DownloadService.ts`) to get the exact suffix pattern (uuid or timestamp). Match that exact pattern instead of a substring.

### Bug 3 — `apps/cli/src/services/download/DownloadService.ts:1494-1510`

```ts
if (
  normalized.includes("http error 403") ||
  normalized.includes("http error 401") ||
  normalized.includes("forbidden") ||
  normalized.includes("unauthorized")
) {
  return { failureKind: "http-auth", retryable: false };
}
if (normalized.includes("http error 4")) {
  // catches 429 and 408 → non-retryable
  return { failureKind: "http-client", retryable: false };
}
if (normalized.includes("http error 5")) {
  return { failureKind: "http-server", retryable: true };
}
```

Repo conventions: TypeScript, Node `fs` for these sync ops (per CLAUDE.md guidance), conventional commits.

## Commands you will need

| Purpose        | Command                                   | Expected |
| -------------- | ----------------------------------------- | -------- |
| Typecheck      | `bun run typecheck`                       | exit 0   |
| Lint           | `bun run lint`                            | exit 0   |
| One file       | `cd apps/cli && bun run test:file <path>` | pass     |
| Provider tests | `bun run --cwd packages/providers test`   | pass     |
| CLI tests      | `bun run --cwd apps/cli test`             | pass     |

## Scope

**In scope**:

- `packages/providers/src/allmanga/direct.ts`
- `apps/cli/src/services/download/DownloadService.ts`
- `apps/cli/test/unit/services/download/download-failure-classification.test.ts` (create or extend — check `ls apps/cli/test/unit/services/download/`)
- `apps/cli/test/unit/services/download/temp-file-cleanup.test.ts` (create if no existing home)
- A provider test for the URL guard (check `ls packages/providers/test/` for the allmanga test file to extend)

**Out of scope**:

- The wider resolve/try structure in allmanga — only wrap the single `new URL`.
- yt-dlp invocation flags (`--retries` etc.) — unchanged.
- Any other failure-classification branch.

## Git workflow

- Branch: `advisor/003-provider-download-correctness`
- Commit per bug (3 commits) or one `fix(cli,providers): guard url mapping, temp cleanup, and 429 retry` — match repo preference.

## Steps

### Step 1: Guard the AllManga URL mapping

Introduce a `safeHostname(url: string): string | null` helper (local to the file, or reuse one if `grep -rn "safeHostname" packages/providers/src` finds an existing one). Replace the inline `new URL(link.url).hostname` so a throw yields `null` and the offending link is skipped (`continue`) rather than aborting the whole map — mirror `miruro/direct.ts:712-719`. If the host is required for the evidence object, skip pushing that one source rather than the whole set.

**Verify**: `bun run --cwd packages/providers test` → pass; `bun run typecheck` → exit 0.

### Step 2: Narrow temp-file deletion to Kunai's exact pattern

Replace `entry.name.includes(".tmp.")` with a regex matching only Kunai's temp suffix. Example if the suffix is a uuid: `/\.tmp\.[0-9a-f-]{8,}$/i`. Use the actual pattern you found in Step "Current state". A file must match the _full_ Kunai temp shape to be deleted.

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Make 429/408 retryable

Add a branch **before** the `http error 4` catch-all:

```ts
if (
  normalized.includes("http error 429") ||
  normalized.includes("http error 408") ||
  normalized.includes("too many requests")
) {
  return { failureKind: "http-client", retryable: true };
}
```

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Tests

- Download failure classification: assert 429 → `retryable: true`; 408 → `retryable: true`; 403 → `retryable: false` (unchanged); 404 → `retryable: false` (unchanged); 500 → `retryable: true` (unchanged).
- Temp cleanup: given a dir with `movie.mp4.tmp.<uuid>` (deleted) and `backup.tmp.old` + `notes.tmp.txt` (preserved), only the Kunai temp is removed. Use a real temp dir under the OS tmp (or `$CLAUDE_JOB_DIR/tmp` if set); clean up after.
- AllManga URL guard: a link set containing one relative/garbage URL and one valid URL yields at least the valid stream (does not throw / does not return empty). Extend the existing allmanga provider test.

**Verify**: run each new/changed test file with `bun run test:file` (cli) and `bun run --cwd packages/providers test` → all pass.

### Step 5: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test && bun run --cwd packages/providers test` → all exit 0.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint` exit 0
- [ ] `grep -n 'new URL(link.url)' packages/providers/src/allmanga/direct.ts` returns nothing (replaced by guarded helper)
- [ ] `grep -n 'includes(".tmp.")' apps/cli/src/services/download/DownloadService.ts` returns nothing
- [ ] 429/408 branch present and returns `retryable: true`; new tests cover all three bugs and pass
- [ ] No files outside scope modified; `plans/README.md` row updated

## STOP conditions

- The AllManga `new URL` line is not at/near `:393` and grep can't find it (drifted).
- Kunai's temp-file naming can't be determined from the source (pattern ambiguous) — report before narrowing, to avoid the opposite bug (leaving real orphans).
- The failure-classification function is consumed by callers that treat `retryable` in a way that would loop forever on a hard 429 — check `grep -rn "analyzeDownloadFailure\|retryable" apps/cli/src/services/download/` and confirm there's a retry cap; if none, report.

## Maintenance notes

- The retry cap (max attempts / backoff) for 429 lives in the download runner — reviewer should confirm a bounded retry count exists so a permanent 429 can't spin forever.
- If temp-file naming ever changes, the cleanup regex must change in lockstep — keep them defined near each other.
