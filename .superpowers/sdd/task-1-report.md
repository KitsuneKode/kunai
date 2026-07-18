# Startup/Shutdown Reliability Task 1 Report

Status: DONE_WITH_CONCERNS

## Scope completed

- Verified the existing root development entrypoint is exactly `"dev": "bun apps/cli/src/main.ts"`.
- Verified the root content path uses `RootOverlayLoader`, and `RootOverlayLoader` demand-loads `./root-overlay-shell`.
- Verified the deterministic loader test covers Escape while the loading scaffold owns input.
- No startup source adjustment was needed, so no TDD code-change cycle was performed.
- Used only a shadow XDG profile under `$CLAUDE_JOB_DIR/tmp`; no live Kunai config, data, or cache path was used.
- Did not commit.

## Files changed by this task

- `/home/kitsunekode/Projects/hacking/kitsunesnipe/.superpowers/sdd/task-1-report.md` — replaced a stale report for an unrelated earlier task with this Task 1 report.
- No product source or test file was edited by this task.
- The `package.json` `scripts.dev` hunk was already present when the task started and was verified, not rewritten.

Task artifacts outside the repository were written under `/home/kitsunekode/.claude/jobs/717e1330/tmp`, including:

- `protected-package-wip.patch`
- `protected-work-before.sha256`
- `startup-cold-samples.txt`
- focused-test and gate output captures

## Commands and observed outputs

### Protected WIP snapshot

```sh
git diff -- package.json apps/docs/package.json apps/docs/lib/generated-metadata.json bun.lock > "$CLAUDE_JOB_DIR/tmp/protected-package-wip.patch"
git status --short
```

Initial output showed the pre-existing notification work, docs/package/lock changes, root `package.json`, and untracked handoff/plan files. The protected package patch was captured successfully with SHA-256:

```text
d9f969997d8383b0545104788978b9c76421095dc57e63f3758823d248ad6f8d
```

### Root development script

```sh
git diff -- package.json
```

Verified the owned hunk is:

```diff
-    "dev": "bun run --cwd apps/cli dev",
+    "dev": "bun apps/cli/src/main.ts",
```

The same root diff also contains unrelated pre-existing catalog/devDependency updates; this task did not modify them.

### Focused startup tests

Exact command, run twice with a final fresh run after the manual probes:

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli test:file \
  test/unit/architecture/dev-entrypoint.test.ts \
  test/unit/architecture/boundary-imports.test.ts \
  test/unit/app/bootstrap/startup-setup.test.ts \
  test/unit/app/search/search-startup-policy.test.ts \
  test/unit/app-shell/root-overlay-loader.test.tsx \
  test/unit/app-shell/browse-first-paint.useinput.test.tsx \
  test/unit/services/diagnostics/cli-startup-milestone.test.ts
```

Final output:

```text
bun test v1.3.14 (0d9b296a)
21 pass
0 fail
49 expect() calls
Ran 21 tests across 7 files. [624.00ms]
```

The earlier run also passed all 21 tests with 0 failures and 49 assertions in 418 ms.

### Repository gates

```sh
bun run lint
```

Output summary:

```text
Tasks: 11 successful, 11 total
Found 2 warnings and 0 errors in @kitsunekode/kunai
```

Warnings:

- `apps/cli/src/app-shell/RootOverlayLoader.tsx:65` — `promise(always-return)`
- `apps/cli/src/app-shell/primitives/MediaListShell.tsx:29` — `eqeqeq`

```sh
bun run typecheck
```

Output summary:

```text
Tasks: 12 successful, 13 total
Failed: @kitsunekode/kunai#typecheck
```

The CLI typecheck failed on concurrent protected work in `apps/cli/src/app-shell/root-overlay-shell.tsx:980-981`:

```text
TS2322: openReleasePage callback returns void instead of boolean | Promise<boolean>
TS2304: Cannot find name 'openExternalUrl'
```

```sh
bun run fmt:check
```

Output summary:

```text
Tasks: 23 successful, 24 total
Failed: @kitsunekode/kunai#fmt:check
```

Formatting issues were reported in concurrent/unrelated files:

```text
src/app-shell/root-overlay-shell.tsx
src/app/playback/playback-provider-switch.ts
```

`bun run fmt` was intentionally not run because it is write-mode and could alter protected concurrent work. `fmt:check` was used as the non-mutating verification.

### Diff verification

```sh
git diff --check
```

Output:

```text
apps/cli/src/app/playback/playback-provider-switch.ts:212: new blank line at EOF.
exit code 2
```

The failure is outside Task 1's owned startup diff and appeared during concurrent work.

Scoped command:

```sh
git diff --check -- \
  package.json \
  apps/cli/src/app-shell/root-content-shell.tsx \
  apps/cli/src/app-shell/RootOverlayLoader.tsx \
  apps/cli/src/app-shell/ink-shell.tsx \
  apps/cli/test/unit/architecture/dev-entrypoint.test.ts \
  apps/cli/test/unit/app-shell/root-overlay-loader.test.tsx
```

Output:

```text
exit_code=0
```

The startup diff contains the root `scripts.dev` hunk plus unrelated pre-existing root package dependency/catalog hunks. No Notifications Inbox implementation file appears in the scoped startup diff.

## Three controlled startup samples

Shadow profile:

```text
/home/kitsunekode/.claude/jobs/717e1330/tmp/startup-shadow
```

Profile setup:

```sh
SHADOW="$CLAUDE_JOB_DIR/tmp/startup-shadow"
rm -rf "$SHADOW"
mkdir -p "$SHADOW/config/kunai" "$SHADOW/data/kunai" "$SHADOW/cache/kunai"
printf '%s\n' '{"onboardingVersion":2,"downloadOnboardingDismissed":true}' \
  > "$SHADOW/config/kunai/config.json"
```

For each sample, only `$SHADOW/cache` was removed and recreated. Each launch used:

```sh
env \
  XDG_CONFIG_HOME="$SHADOW/config" \
  XDG_DATA_HOME="$SHADOW/data" \
  XDG_CACHE_HOME="$SHADOW/cache" \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
  bun run dev -- --debug-json
```

The measurement is `session.startup.browse-mounted` → `context.elapsedMs`. Each corresponding tmux capture showed `Search title` and `ready`.

| Sample | Search paint milestone |
| ------ | ---------------------: |
| 1      |                 436 ms |
| 2      |                 375 ms |
| 3      |                 589 ms |

Summary:

```text
min 375 ms
median 436 ms
max 589 ms
mean 466.7 ms
```

All three controlled local samples are below the prior 2.1–2.2 second baseline. This is not claimed as a stable threshold or a machine-wide cold-start benchmark; the controls reset the shadow application cache and disable Bun's runtime transpiler cache, but do not flush operating-system page caches.

The samples were saved to:

```text
/home/kitsunekode/.claude/jobs/717e1330/tmp/startup-cold-samples.txt
```

## Manual tmux observations

Protected-session safety override:

```sh
if tmux has-session -t kunai-debug-lazy-1784270556233673286 2>/dev/null; then ...; fi
```

Observed:

```text
protected_session_exists=no
```

The protected session did not exist. It was not killed or modified.

Fresh sessions created only for this task included the main smoke, three sample sessions, and one focused input-preservation probe. All task-owned sessions were removed. Final tmux listing contained only the pre-existing unrelated session:

```text
kunai-startup-check-1784272190681599670
```

Observed behavior in the shadow profile:

1. The first useful screen was the ready Browse surface with `Search title`.
2. Typing `zeta` immediately became visible in the search field.
3. `/notifications` opened as a generic root-overlay smoke; the notifications surface rendered without a blank terminal or crash.
4. The loading scaffold was too brief to observe manually, so no manual Escape-on-scaffold claim is made. The deterministic loader unit test passed and asserts `CLOSE_TOP_OVERLAY` after Escape while the import never resolves.
5. Closing and reopening `/notifications` rendered the overlay again.
6. Help opened after the overlay smoke and rendered its browse/global command sections.
7. No blank terminal, duplicate footer, or crash was observed.
8. Search text was preserved when the command palette alone was opened and closed, but after opening and closing `/notifications`, the prior `zeta` input reset to the `Breaking Bad` placeholder. Therefore the manual `no lost input` condition was not fully satisfied.

No Notifications Inbox semantics or action behavior were inspected or changed.

## Protected-work verification

- The before/after package WIP patches for `package.json`, `apps/docs/package.json`, `apps/docs/lib/generated-metadata.json`, and `bun.lock` were byte-identical.
- Hashes for `package.json`, both docs files, `bun.lock`, `.plans/HANDOFF-2026-07-17.md`, `notification-overlay-model.ts`, and `notification-overlay-model.test.ts` remained unchanged across this task.
- `apps/cli/src/app-shell/root-overlay-shell.tsx` changed concurrently during verification: SHA-256 moved from `4da5cb9aba9d4c821c09114c97d31e0b004ae2f1712d3896ec2324d3e90a8f5e` to `6b86018b42430c72208649a89b26f786d76ae152cafb9823b42596badd08a48b`. This task issued no Edit/Write operation against that file and did not revert the concurrent work.
- Additional notification/session/playback files appeared or changed in `git status` while the task was running. They were left untouched.
- The report file is the only repository file written by this task.

## Self-review

- Requirements were reread after verification, and every step was checked against observed evidence.
- The direct root entrypoint is covered by `dev-entrypoint.test.ts` and avoids the nested package-script startup path.
- The root overlay implementation remains demand-loaded through `RootOverlayLoader`; the canonical root content and Ink shell do not eagerly import `root-overlay-shell`.
- Loader failure resets the in-flight promise for a later retry, and the focused tests passed for both loading-Escape and failed-import retry behavior.
- No source change was made merely for style or to absorb unrelated concurrent failures.
- No live user profile was used, no protected tmux session was changed, and no commit was created.

## Concerns

1. Manual smoke found a real input-preservation gap: search text resets after opening and closing `/notifications`, although it survives command-palette open/close. This is outside Task 1's package-script ownership and was not patched here.
2. Repository-wide typecheck and formatting gates are currently red because of concurrent protected/unrelated work in `root-overlay-shell.tsx` and `playback-provider-switch.ts`; lint passes with two warnings.
3. The loading scaffold did not remain visible long enough for manual Escape interaction. Escape behavior is verified deterministically by the passing unit test, not claimed from manual observation.
4. A protected Notifications file changed concurrently during the task. The task did not alter or revert it, but exact before/after whole-tree immutability was therefore not obtainable in the shared working tree.

## Review fixes

### Files changed

- `/home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/src/app/search/SearchPhase.ts` — owns one Browse query draft for the lifetime of the search phase, passes it through Browse shell turnover, and resynchronizes it after routes that intentionally replace the query.
- `/home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/src/app-shell/browse-shell.tsx` — reads/writes the shared draft while retaining a local fallback for direct callers.
- `/home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/test/unit/app-shell/root-overlay-loader.test.tsx` — covers draft preservation across a real Browse command handoff and reducer-backed removal of the cold loading scaffold.
- `/home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/src/app-shell/RootOverlayLoader.tsx` and `/home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/src/app-shell/cancel-root-overlay.ts` — retained the interrupted fixer's generic loading-Escape cancellation seam; no notification-specific path was added.
- `/home/kitsunekode/Projects/hacking/kitsunesnipe/.superpowers/sdd/task-1-report.md` — appended this review-fix evidence.

No Notifications Inbox implementation/source/test file, SessionState file, playback-provider-switch file, docs app file, lockfile, root dependency/catalog hunk, or handoff was edited by this review-fix pass. No commit was created.

### TDD evidence

The initial reducer-backed overlay test exposed the original draft reset:

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli test:file \
  test/unit/app-shell/root-overlay-loader.test.tsx
```

Observed red result before the draft seam:

```text
2 pass
1 fail
Expected to contain: "Dune"
Received: Browse with the "Breaking Bad" placeholder
```

After moving draft ownership to the search-phase controller and passing the same draft through each Browse mount, the targeted test result was:

```text
3 pass
0 fail
12 expect() calls
Ran 3 tests across 1 file. [367.00ms]
```

### Final commands and results

Focused startup suite:

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli test:file \
  test/unit/architecture/dev-entrypoint.test.ts \
  test/unit/architecture/boundary-imports.test.ts \
  test/unit/app/bootstrap/startup-setup.test.ts \
  test/unit/app/search/search-startup-policy.test.ts \
  test/unit/app-shell/root-overlay-loader.test.tsx \
  test/unit/app-shell/browse-first-paint.useinput.test.tsx \
  test/unit/services/diagnostics/cli-startup-milestone.test.ts
```

```text
22 pass
0 fail
55 expect() calls
Ran 22 tests across 7 files. [473.00ms]
```

Repository gates:

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe typecheck
```

```text
Tasks: 13 successful, 13 total
```

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe lint
```

```text
Tasks: 11 successful, 11 total
Found 1 warning and 0 errors in @kitsunekode/kunai
```

The remaining warning is the existing `promise(always-return)` warning at `apps/cli/src/app-shell/RootOverlayLoader.tsx:66`.

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe fmt:check
```

```text
Tasks: 24 successful, 24 total
```

```sh
git diff --check -- \
  apps/cli/src/app/search/SearchPhase.ts \
  apps/cli/src/app-shell/RootOverlayLoader.tsx \
  apps/cli/src/app-shell/browse-shell.tsx \
  apps/cli/src/app-shell/cancel-root-overlay.ts \
  apps/cli/test/unit/app-shell/root-overlay-loader.test.tsx \
  .superpowers/sdd/task-1-report.md
```

```text
exit_code=0
```

### Manual generic-overlay evidence

Used only the isolated shadow profile at `/tmp/kunai-task1-review-fix.SnQBQ9` with a task-owned tmux socket; no live Kunai config, data, or cache path was used. Notifications were not opened or inspected.

Launch command:

```sh
env \
  XDG_CONFIG_HOME=/tmp/kunai-task1-review-fix.SnQBQ9/config \
  XDG_DATA_HOME=/tmp/kunai-task1-review-fix.SnQBQ9/data \
  XDG_CACHE_HOME=/tmp/kunai-task1-review-fix.SnQBQ9/cache \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
  bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe dev
```

Observed sequence after the final fix:

1. Browse opened ready with `Search title`.
2. Typed `Dune`; the input rendered `⌕ Dune`.
3. Opened `/help`; the generic root Help overlay rendered.
4. Pressed Escape; Browse returned with `⌕ Dune`, not the `Breaking Bad` placeholder.
5. Repeated the `/help` → Escape cycle; `⌕ Dune` remained visible again.
6. No blank terminal, duplicate footer, or crash was observed.

An earlier manual probe of the interrupted closure-only implementation reproduced the reviewer issue: closing Help restored the `Breaking Bad` placeholder. That evidence caused draft ownership to be moved from one `openBrowseShell` call to the search-phase controller shared across shell turnover.

### Self-review

- The preservation path is generic: it is owned by SearchPhase/BrowseShell and contains no notification-specific branch.
- The mutable draft is scoped to one SearchPhase execution, so it survives generic overlay handoffs without becoming process-global or leaking into later sessions.
- Routes that intentionally replace the canonical query resynchronize the shared draft, avoiding stale text after filters, recommendations, trending, calendar, random, or surprise routes.
- The loading-Escape test uses the real `SessionStateManagerImpl` reducer, asserts `activeModals` becomes empty, asserts `Opening panel` disappears, and asserts the underlying root content is rendered; it no longer proves only that an action was dispatched.
- The regression test drives Browse input, command resolution, root overlay state, shell teardown, and Browse remount rather than patching or mocking Notifications Inbox behavior.
- Focused tests, typecheck, lint, formatting, scoped diff checks, and the isolated TUI smoke were rerun after the final source changes.

### Review-fix concerns

- The real dynamic import completes too quickly for a reliable manual Escape-on-loading-scaffold capture. That exact cold-loading state remains deterministic in the reducer-backed unit test.
- The shared working tree continued to receive unrelated concurrent changes. This pass did not edit or revert protected notification, SessionState, playback, docs, lockfile, package catalog/dependency, or handoff work.

### Lane-switch re-review fix

The re-review found that the controller-owned draft correctly survived generic overlay turnover but could also survive a real catalog-lane change, even though `SET_MODE` had cleared `SessionState.searchQuery` and results. The draft now records its owning `ShellMode`; `openBrowseShell` resets the value from the new lane's `initialQuery` only when that mode changes. Same-lane overlay turnover and non-mode route preservation remain unchanged.

Focused TDD red command:

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli test:file \
  test/unit/app-shell/root-overlay-loader.test.tsx
```

Red result before mode ownership was added:

```text
3 pass
1 fail
16 expect() calls
Expected not to contain: "Dune"
Received: anime Browse with "Dune" still in the input
```

Green result after the fix:

```text
4 pass
0 fail
17 expect() calls
Ran 4 tests across 1 file. [382.00ms]
```

The new test types an unsubmitted `Dune` draft in series mode, resolves the real Browse `toggle-mode` action, dispatches the real reducer `SET_MODE` transition to anime, remounts Browse with the same shared draft, and proves the new lane shows an empty input (`Demon Slayer` placeholder) instead of stale `Dune` text.

Final focused startup suite:

```sh
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli test:file \
  test/unit/architecture/dev-entrypoint.test.ts \
  test/unit/architecture/boundary-imports.test.ts \
  test/unit/app/bootstrap/startup-setup.test.ts \
  test/unit/app/search/search-startup-policy.test.ts \
  test/unit/app-shell/root-overlay-loader.test.tsx \
  test/unit/app-shell/browse-first-paint.useinput.test.tsx \
  test/unit/services/diagnostics/cli-startup-milestone.test.ts
```

```text
23 pass
0 fail
60 expect() calls
Ran 23 tests across 7 files. [531.00ms]
```

Final repository gates after the lane fix:

```text
bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe typecheck
Tasks: 13 successful, 13 total

bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe lint
Tasks: 11 successful, 11 total
Found 0 warnings and 0 errors in @kitsunekode/kunai

bun run --cwd /home/kitsunekode/Projects/hacking/kitsunesnipe fmt:check
Tasks: 24 successful, 24 total
```

Manual isolated TUI evidence used the existing shadow XDG profile at `/tmp/kunai-task1-review-fix.SnQBQ9` and a task-owned tmux socket:

1. Series Browse rendered ready.
2. Typed unsubmitted `Dune`; `⌕ Dune` was visible.
3. Pressed Tab to switch lanes.
4. Anime Browse rendered as `anime · AllManga` with the empty `Demon Slayer` placeholder; `Dune` was absent.
5. The task-owned tmux server was stopped after capture. No live user data or Notifications path was used.

No commit was created.
