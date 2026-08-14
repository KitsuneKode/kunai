# Retained PR Reliability Design

**Date:** 2026-07-18  
**Status:** Approved design; implementation waits for current notification/startup WIP to settle  
**Source references:** archived PRs #6, #7, #8, #10, #13, and #15

## Purpose

Recover the useful reliability patterns from the stale AD11 pull-request stack without merging, rebasing, or cherry-picking its outdated branches. Implement each retained idea against the current `main` architecture as a bounded, independently reviewable change.

The work must preserve all current local WIP, avoid broad playback/provider rewrites, and favor correctness, diagnosability, and deterministic proof over historical patch fidelity.

## Delivery Strategy

After the active notification/startup WIP is committed or otherwise settled:

1. Create one normal local branch from the exact current `main` tip.
2. Do not use a worktree.
3. Do not rebase or upgrade the stale PR branches.
4. Do not cherry-pick historical commits.
5. Use the retained PR branches only as behavior and regression-test references.
6. Land six narrow commits in the sequence below.

The retained GitHub PRs remain drafts and reference branches until their current-main replacements land. Their remote branches must not be deleted during this work.

## Slice 1: CI Bootstrap Contract

### Problem

The local composite action `.github/actions/setup-bun-monorepo/action.yml` contains `actions/checkout`, while multiple workflow jobs invoke that local action before checking out the repository. GitHub must load a local action from the workspace before any step inside it can execute, so checkout inside the local action is too late.

### Ownership

- Workflow jobs own checkout.
- The local composite owns Bun setup, Bun cache, Turbo cache, and frozen dependency installation.
- `.docs/repo-infrastructure.md` owns the durable infrastructure rule.

### Design

- Remove checkout from the local composite.
- Add checkout before every local-composite invocation in `ci.yml`, `release.yml`, and `build-binaries.yml`.
- Preserve full-history/blob-filter options where affected calculations or release behavior need them.
- Preserve already-correct ordering in `provider-matrix.yml`.
- Add a static repository test that fails when:
  - the local composite contains checkout; or
  - a workflow job invokes the local composite without a preceding checkout in that job.

This slice does not automatically port PR #8 installer, native-smoke, or release-asset changes.

### Completion Proof

- Static workflow contract test passes.
- Repository gates pass.
- A real GitHub Actions run reaches and executes the composite-action steps.

## Slice 2: Overlay Lifecycle and Input Suspension

### Problem

Opening a root-owned overlay while browse or post-play content is mounted renders only the overlay. The session object remains stored, but its React subtree unmounts. Closing the overlay remounts a fresh subtree and loses component-local query, selection, filter, preview, and calendar state.

Keeping the subtree mounted without suspending input and timers would create hidden competing input owners and background work.

### Ownership

- `root-content-state.ts` owns mounted session identity and resolved root-content state.
- `root-content-shell.tsx` owns visible composition of mounted content and overlays.
- A shell-local suspension context owns whether retained content may process input or recurring visual work.
- `ShellFrame` and `BrowseShell` consume the suspension state.
- `useCalendarNow` remains the timer primitive.

### Design

Add a resolved state representing an overlay over retained mounted content.

Retain only:

- `browse`;
- `post-playback`.

Do not retain through this mechanism:

- `picker`;
- `loading`;
- active playback root surfaces.

When retained content is hidden:

- render it in the Ink tree without visible stacking;
- suspend its hard-global input, footer input, command input, help handling, fallback input, and browse-local input;
- keep the visible root overlay outside the suspended provider;
- run the calendar timer only when the calendar view is active and retained content is not suspended.

The existing efficient calendar contract remains: non-calendar browse sessions must not gain a minute timer.

### Failure Rules

- A hidden subtree must never receive overlay keystrokes.
- Overlay closure must reveal the same mounted state, not a remounted initial state.
- Input suspension and keep-alive must land atomically; neither is safe alone.

### Completion Proof

- Browse and post-play state survive settings/help/history/diagnostics open and close.
- Picker/loading do not use retained-overlay state.
- Hidden content ignores stdin.
- Calendar intervals pause and resume on the same mount.
- Existing root-content and first-paint tests remain green.

## Slice 3: Shell Input Single Ownership

### Problem

`ShellFrame` uses one input path for footer/palette resolution and another for `onUnhandledInput`. Ink delivers the same key to both handlers. Enabled footer letters can therefore resolve once through the footer and again through the surface fallback, especially on post-play.

### Ownership Rule

1. Suspended input is dropped.
2. When `letterKeysHandledExternally` is true, footer letter resolution is disabled and the surface receives the letter.
3. Otherwise, an enabled footer-owned letter resolves once and is not forwarded to `onUnhandledInput`.
4. Disabled footer keys and unbound keys may continue to the surface fallback.
5. Command mode, palette ownership, locked input, help, and hard-global behavior remain unchanged except where suspension explicitly disables the hidden subtree.

The shared rule belongs in `ShellFrame`; do not duplicate post-play key lists or move ownership into footer presentation code.

### Completion Proof

- `o`, `r`, `n`, and `m` dispatch once on post-play.
- `j`, `k`, arrows, Enter, and recommendation digits retain current surface behavior.
- Externally owned playback/loading letters remain externally owned.
- The existing input bridge test explicitly proves that a resolved footer key is absent from unhandled delivery.

## Slice 4: Diagnostics Trust and UI Parity

### Problem

Current diagnostics reads return global durable rows whenever any exist, allowing stale prior-session SQLite events to mask current in-memory events. Durable failure can also hide healthy memory evidence.

The diagnostics panel assembles richer subsystem evidence than export/report paths. Palette diagnostics and workflow diagnostics also use different presentation paths, and only one path performs fresh YouTube probes.

### Ownership

- `DiagnosticsServiceImpl` owns memory/durable read policy.
- The diagnostic-events repository owns SQL and session queries.
- The durable sink exposes session reads and failed-state information without leaking storage implementation upward.
- An app-shell diagnostics input builder owns extraction from `Container`.
- Services must not import `Container` or app-shell modules.
- One app-shell preparation function owns memory sampling, YouTube probes, and opening the root diagnostics overlay.

### Read Contract

`getRecent(limit)`:

1. Read memory newest-first.
2. If no durable sink exists or it has failed, return memory.
3. Prefer durable rows for the active session.
4. Retain a compatibility fallback to global durable recent only when session querying is unavailable.
5. Merge memory and durable events newest-first.
6. Deduplicate persisted copies of the same event.
7. Enforce the requested limit.

`getSnapshot()` returns the merged bounded set in chronological order for support-bundle construction.

Read and write failures log bounded warnings and fall back to memory rather than making diagnostics unavailable.

### Shared Panel and Export Input

Build support-bundle input from the same subsystem snapshots as the panel, including:

- capabilities;
- session state;
- current playback source inventory;
- download summary;
- release summary and reconciliation diagnostics;
- presence snapshot;
- runtime memory samples;
- provider-health lookup.

Export and report paths call this shared builder.

### Unified Diagnostics UI

Both palette and workflow entry points:

1. record a runtime memory sample;
2. run fresh YouTube diagnostics probes, which record normal diagnostic events;
3. open the same root-owned diagnostics overlay.

The old selectable static-info diagnostics path is no longer an owner.

### Deferred Diagnostics Extras

The following historical PR #7 additions remain outside this slice:

- richer correlation preference changes;
- extra timeout scanning embellishments;
- richer issue-draft copy.

They may be reconsidered later as separate narrow changes.

### Completion Proof

- Session-scoped merge, deduplication, ordering, limit enforcement, failed-sink fallback, and chronological snapshots are tested.
- Bootstrap passes the active session ID.
- Panel and exported bundle produce equivalent insight for the same degraded subsystem.
- Palette and workflow diagnostics open the same overlay and retain fresh YouTube evidence.
- Redaction tests remain green.
- Manual `/diagnostics` and `/export-diagnostics` outputs agree.

## Slice 5: Source-Inventory Quality Partition

### Problem

The stream cache includes `qualityPreference`, but source-inventory cache identity does not. A cached `ProviderResolveResult` contains a selected stream, so inventory produced under one quality preference can influence reuse under another quality preference.

### Ownership

- `SourceInventoryService` owns source-inventory identity and schema version.
- Resolve, invalidation, track hints, lazy probes, and lazy-probe in-flight deduplication must construct the same identity.
- The storage repository continues storing an opaque hashed key; no SQL migration is needed.

### Design

- Add optional `qualityPreference` to `SourceInventoryCacheInput`.
- Include it in the cache-key preimage.
- Bump schema identity from `v4` to `v5`.
- Forward quality through:
  - resolve-time inventory get/set/delete;
  - explicit episode/title invalidation;
  - cached cross-provider track lookups;
  - Videasy lazy-probe inventory keys;
  - Videasy phase-B in-flight deduplication.
- Leave provider-wide invalidation unchanged.

Old `v4` rows become unreachable by design; serialized inventory shape does not change.

### Documentation

Document the current exception to the general inventory contract:

- quality is ideally a projection over complete inventory;
- current cached inventory contains a quality-influenced selected stream;
- rows are therefore partitioned by quality until inventory selection becomes fully quality-neutral.

### Completion Proof

- `auto`, `720p`, and `1080p` keys are distinct.
- Every caller forwards quality consistently.
- Different-quality lazy probes do not suppress each other.
- Diagnostics expose only bounded key hashes, never raw preimages.
- Default tests perform no live-provider calls.

## Slice 6: Installer and Release Audit

### Purpose

Distribution quality matters, but the historical PR #8 installer and release changes must not be ported blindly after current-main evolution.

### Evidence-First Audit

Inspect current behavior for:

- `install.sh` dry-run, dependency handling, empty release assets, and actionable failures;
- `install.ps1` equivalent behavior, control flow, and dependency reachability;
- release workflow unmatched-file handling and post-upload asset assertions;
- binary target topology and native smoke coverage;
- documentation consistency with supported installation paths.

### Decision Rule

Only confirmed current gaps become implementation changes. Keep each installer/release change narrow and covered by deterministic tests. Do not couple distribution verification to live provider availability.

### Completion Proof

- Shell and PowerShell dry runs are deterministic.
- Empty or missing assets produce actionable failures.
- Expected binary assets and smoke checks match the current release topology.
- Documentation names working fallback installation paths.

## Test and Verification Strategy

Use regression-first focused tests for each slice. After each commit, run the smallest relevant tests and required static checks. Before completion, run:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

Manual verification must include:

- first post-play `o`, `r`, `n`, and `m` press dispatches once;
- browse query, selection, and calendar filters survive overlay open/close;
- hidden browse does not react to overlay input;
- calendar recurring work pauses beneath overlays;
- `/diagnostics` and `/export-diagnostics` agree for the same degraded subsystem;
- installer dry-run paths produce accurate output.

A real GitHub Actions run is required to verify the CI bootstrap slice because local tests cannot reproduce GitHub loading a local composite action before job steps execute.

## Commit and Review Structure

Use one implementation branch and six independently reviewable commits in this order:

1. `fix(ci): require checkout before local composite actions`
2. `fix(shell): preserve mounted state under root overlays`
3. `fix(shell): prevent footer key double dispatch`
4. `fix(diagnostics): unify live evidence and bundle inputs`
5. `fix(cache): partition source inventory by quality`
6. `fix(distribution): harden verified installer and release gaps`

The sixth commit may be omitted if the audit finds no current gap; in that case record the evidence in the implementation report rather than manufacturing a change.

## Completion and PR Cleanup

The implementation is complete only when:

- focused and full gates pass;
- required manual behavior has been observed;
- GitHub Actions successfully runs the corrected checkout/composite sequence;
- no active notification/startup WIP was overwritten or mixed into the retained-work commits;
- the current-main replacements are documented clearly enough to close retained PRs #6, #7, #8, and #13 without deleting their branches.
