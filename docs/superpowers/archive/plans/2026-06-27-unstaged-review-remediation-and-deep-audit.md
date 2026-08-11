# Unstaged Review Remediation And Deep Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the high-confidence regressions found in the current unstaged tree, then deepen verification across CI, diagnostics, UI state, packaging, and unseen edge cases before accepting the change set.

**Architecture:** Keep fixes at the owning boundary: GitHub workflow bootstrapping in workflow/action files, diagnostics interpretation in `apps/cli/src/services/diagnostics`, shell rendering in `apps/cli/src/app-shell`, and packaging verification in scripts/tests. Do not patch symptoms in render components when the source of truth is a model/helper. The final state should reduce false diagnostics, make correlation data joinable, keep release gates runnable, and add render-capture coverage for the new Sakura media panel states.

**Tech Stack:** Bun, TypeScript, Ink/React 19, Turbo, GitHub Actions, local render-capture harness, Bun test.

## Global Constraints

- Treat the current dirty tree as user-owned work. Do not revert unrelated changes.
- Use `bun`, `bunx`, and `bun run`; do not use `bun test` directly.
- Before changing shell UI, read `.docs/ux-architecture.md`, `.docs/design-system.md`, and `.docs/testing-strategy.md`.
- Before changing diagnostics, read `.docs/diagnostics-guide.md` and `docs/superpowers/specs/2026-06-25-diagnostics-observability-design.md`.
- Before changing CI/release/package scripts, read `.docs/repo-infrastructure.md`, `.docs/release-reliability-gate.md`, and `RELEASING.md`.
- Do not add `ink-testing-library`; use `apps/cli/test/harness/render-capture.ts`.
- Do not introduce remote telemetry or unbounded diagnostics storage.
- All support-bundle and diagnostics paths must stay redacted: no stream URLs, subtitle URLs, headers, cookies, tokens, raw local home paths, or provider secrets.
- Keep package publication split: npm ships `dist/kunai.js`, `dist/assets/**`, `README.md`, `LICENSE`; compiled binaries ship through GitHub Releases only.
- Run `bun run typecheck`, `bun run lint`, and `bun run fmt` before final handoff; run `bun run test` after the focused tests pass if time permits.

---

## File Structure

- `.github/actions/setup-bun-monorepo/action.yml`: shared Bun/cache/install action. It must not perform checkout if workflows call it from a local path before checkout.
- `.github/workflows/ci.yml`: PR/main gates for fmt, lint, typecheck, test, docs, CLI build, binary build, installer smoke.
- `.github/workflows/release.yml`: version/publish and release-binary workflow.
- `.github/workflows/build-binaries.yml`: manual or scheduled all-target binary workflow.
- `apps/cli/src/services/diagnostics/diagnostic-event.ts`: normalized event type and context defaults.
- `apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts`: structured event envelope builder and status/severity-to-level mapping.
- `apps/cli/src/services/diagnostics/support-bundle.ts`: bundle triage, correlation summary, event-only fallback.
- `apps/cli/src/services/diagnostics/diagnostics-insight.ts`: pure diagnostics insight builder.
- `apps/cli/src/app-shell/diagnostics-panel-lines.ts`: shell rows for insight output only; no second diagnostics engine.
- `apps/cli/src/app-shell/MediaPanel.tsx`, `media-panel-model.ts`, `media-art.ts`, `loading-shell.tsx`, `post-play-shell.tsx`, `playback-mount-shell.tsx`: new media rail/panel and surfaces that consume it.
- `apps/cli/test/unit/services/diagnostics/*`: diagnostics helper, insight, support-bundle, durable sink tests.
- `apps/cli/test/unit/app-shell/*`: media panel, loading/post-play render-capture, help scope, diagnostics panel line tests.
- `apps/cli/test/integration/npm-pack-guard.test.ts`, `apps/cli/test/unit/scripts/verify-npm-pack.test.ts`: packaging guard tests.
- `.docs/*`, `RELEASING.md`, `apps/cli/test/README.md`: update only after code truth is verified.

---

## Task 0: Build The Authority Map Before Fixing

**Files:**

- Create: `docs/superpowers/plans/2026-06-27-unstaged-authority-map.md`
- Read: `.docs/architecture.md`
- Read: `.docs/runtime-boundary-map.md`
- Read: `.docs/ux-architecture.md`
- Read: `.docs/design-system.md`
- Read: `.docs/diagnostics-guide.md`
- Read: `.docs/repo-infrastructure.md`
- Read: `docs/superpowers/specs/2026-06-25-diagnostics-observability-design.md`
- Read: `.plans/plan-implementation-truth.md`
- Read: `.plans/codebase-architecture-sweep.md`

**Interfaces:**

- Consumes: current dirty tree, architecture docs, and plan-truth docs.
- Produces: a short source-of-truth and duplication map that every later task must use to avoid creating parallel ownership.

- [ ] **Step 1: List the current changed files by ownership seam**

  Run:

  ```bash
  git status --short
  git diff --name-status
  ```

  Create `docs/superpowers/plans/2026-06-27-unstaged-authority-map.md` with this exact header:

  ```markdown
  # Unstaged Authority Map

  ## Purpose

  This map prevents fixes from creating duplicate truth. Code is the current implementation truth; docs explain intent; this file records the ownership decisions for the current dirty-tree remediation only.

  ## Changed Surface Groups
  ```

  Add one bullet per group:

  ```markdown
  - CI/release/package:
  - Diagnostics/observability:
  - Shell UI/media panel/help:
  - Playback/player/provider:
  - Session state:
  - Docs/generated artifacts:
  - Unrelated or uncertain:
  ```

- [ ] **Step 2: Record source-of-truth decisions**

  Add this section:

  ```markdown
  ## Source-Of-Truth Decisions

  | Concern                   | Owning module/doc                                                            | Adapters/renderers                                | Must not duplicate in                   |
  | ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------- |
  | GitHub Bun setup          | `.github/actions/setup-bun-monorepo/action.yml` after workflow checkout      | workflow jobs                                     | per-job copy-pasted install/cache logic |
  | Workflow job selection    | `.github/workflows/ci.yml` `changes` job                                     | downstream jobs                                   | package scripts                         |
  | npm package allowlist     | `apps/cli/package.json` `files` plus `apps/cli/scripts/verify-npm-pack.ts`   | `.npmignore` as defense-in-depth                  | release docs prose                      |
  | binary artifact split     | `apps/cli/scripts/build-binaries.ts` and `turbo.json` binary tasks           | release workflows                                 | npm pack guard only                     |
  | diagnostic event envelope | `apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts`              | subsystem instrumentation call sites              | panel rendering                         |
  | event normalization       | `apps/cli/src/services/diagnostics/diagnostic-event.ts`                      | `DiagnosticsServiceImpl.record`                   | individual services                     |
  | diagnostics triage        | `apps/cli/src/services/diagnostics/diagnostics-insight.ts`                   | `support-bundle.ts`, `diagnostics-panel-lines.ts` | `panel-data.ts`                         |
  | support bundle privacy    | `apps/cli/src/services/diagnostics/support-bundle.ts` plus redaction helpers | report/export commands                            | docs/tests with raw values              |
  | media panel content model | `apps/cli/src/app-shell/media-panel-model.ts`                                | `MediaPanel.tsx`, loading/post-play shells        | per-surface rail builders               |
  | poster/art fallback chain | `apps/cli/src/app-shell/media-art.ts`                                        | media panel and mini posters                      | loading/post-play local helper copies   |
  | session rich metadata     | `apps/cli/src/domain/session/SessionState.ts` reducer                        | playback mount/post-play props                    | component-local mutable state           |
  | shell interaction scope   | `apps/cli/src/app-shell/keybindings.ts`                                      | help overlay rendering                            | hard-coded help copy                    |
  ```

  If code shows any row is wrong, correct the row before implementation. Do not force code to match a stale plan row.

- [ ] **Step 3: Run duplicate-truth searches**

  Run:

  ```bash
  rg -n "buildDiagnosticsPanelLines|buildDiagnosticsInsight|formatHealthStatusLabel|formatRecommendedActionLabel|buildMediaPanel|buildPlaybackPlayingRailView|resolveSeasonAwarePosterUrl|resolveEpisodeThumbUrl|helpSectionsForScope|setup-bun-monorepo|verify-npm-pack|pkg:check" apps/cli/src apps/cli/test .github scripts package.json turbo.json .docs docs/superpowers/specs RELEASING.md
  ```

  Add this section to the authority map:

  ```markdown
  ## Duplicate-Truth Findings

  | Pattern | Keep | Delete/merge/rewrite | Reason |
  | ------- | ---- | -------------------- | ------ |
  ```

  Fill one row for each real duplicate or suspicious parallel implementation. Examples:

  ```markdown
  | diagnostics health labels in panel and service | `diagnostics-insight.ts` formatter | panel-local label mapping if equivalent | service owns interpretation |
  | old playback rail view | `media-panel-model.ts` + `MediaPanel.tsx` | deleted `playback-playing-view.ts` references/tests | one rail model across loading/playing/post-play |
  ```

- [ ] **Step 4: Record deletion-test outcomes**

  Add:

  ```markdown
  ## Deletion Tests

  | Module                               | If deleted, where does complexity reappear?             | Verdict                                                   |
  | ------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------- |
  | `diagnostics-insight.ts`             | panel rows, support bundle triage, diagnostics docs     | keep; deep module                                         |
  | `diagnostic-event-helpers.ts`        | every instrumentation call site                         | keep; deep module if level/severity semantics are correct |
  | `media-panel-model.ts`               | loading shell, post-play shell, future now-playing rail | keep; deep module                                         |
  | `media-art.ts`                       | every artwork rendering surface                         | keep; deep module                                         |
  | `.github/actions/setup-bun-monorepo` | each workflow job                                       | keep; adapter after checkout only                         |
  ```

  Add any shallow modules found during review. A shallow module is one whose interface is nearly as complex as its implementation and does not improve locality.

- [ ] **Step 5: Add an execution rule for later tasks**

  Add:

  ```markdown
  ## Execution Rule

  Before editing any file in Tasks 1-8, check the relevant row above. If a fix needs a second source of truth, stop and either deepen the owning module or update this map with a justified ownership change.
  ```

- [ ] **Step 6: Commit the map only if execution will be split across agents**

  If this work is executed by multiple agents or across sessions, commit the map so every worker has the same truth source:

  ```bash
  git add docs/superpowers/plans/2026-06-27-unstaged-authority-map.md
  git commit -m "docs: map unstaged remediation ownership"
  ```

  If execution is immediate and single-session, leaving it unstaged beside the plan is acceptable.

---

## Task 1: Fix GitHub Actions Bootstrap And Cache Action Risk

**Files:**

- Modify: `.github/actions/setup-bun-monorepo/action.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/build-binaries.yml`
- Test/Verify: `.docs/repo-infrastructure.md`

**Interfaces:**

- Consumes: workflows use the local action `./.github/actions/setup-bun-monorepo`.
- Produces: a reusable action that assumes repository checkout already happened, then sets up Bun/cache/install.

- [ ] **Step 1: Confirm the local-action bootstrap failure mode**

  Inspect every workflow step that starts with:

  ```yaml
  - uses: ./.github/actions/setup-bun-monorepo
  ```

  Confirm whether there is an earlier:

  ```yaml
  - uses: actions/checkout@v5
  ```

  Expected: each job that calls the local composite action must have checkout before the local action. If not, the job cannot load the local action reliably.

- [ ] **Step 2: Move checkout out of the composite action**

  In `.github/actions/setup-bun-monorepo/action.yml`, delete the internal checkout step:

  ```yaml
  - name: Checkout
    uses: actions/checkout@v5
    with:
      fetch-depth: 0
      filter: blob:none
  ```

  Keep the action focused on:

  ```yaml
  - name: Setup Bun
    uses: oven-sh/setup-bun@v2
    with:
      bun-version-file: package.json

  - name: Cache Bun install store
    uses: actions/cache@v5
    with:
      path: ~/.bun/install/cache
      key: ${{ runner.os }}-bun-store-${{ hashFiles('bun.lock') }}
      restore-keys: |
        ${{ runner.os }}-bun-store-

  - name: Cache Turbo local
    if: inputs.skip-turbo-cache != 'true'
    uses: actions/cache@v5
    with:
      path: .turbo
      key: ${{ runner.os }}-turbo-${{ inputs.turbo-cache-prefix }}-${{ github.sha }}
      restore-keys: |
        ${{ runner.os }}-turbo-${{ inputs.turbo-cache-prefix }}-

  - name: Install dependencies
    shell: bash
    run: bun install --frozen-lockfile
  ```

- [ ] **Step 3: Add checkout before every local composite action call**

  In each affected job in `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `.github/workflows/build-binaries.yml`, ensure the first steps are:

  ```yaml
  - uses: actions/checkout@v5
    with:
      fetch-depth: 0
      filter: blob:none

  - uses: ./.github/actions/setup-bun-monorepo
    with:
      turbo-cache-prefix: <job-specific-prefix>
  ```

  Preserve job-specific prefixes (`fmt`, `lint`, `typecheck`, `test`, `build`, `docs`, `binaries`, `release`, `release-binaries`, `binaries-all`).

- [ ] **Step 4: Verify action version assumptions**

  Check whether `actions/cache@v5` and `actions/checkout@v5` are valid in the current repo policy. If local or GitHub verification shows `v5` is unavailable, downgrade consistently to the latest valid major and update `.docs/repo-infrastructure.md` to match.

  Verification options:

  ```bash
  rg -n "actions/cache@|actions/checkout@" .github/workflows .github/actions
  ```

  Optional if `actionlint` is already available locally:

  ```bash
  actionlint .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/build-binaries.yml
  ```

  Expected: no local-action-before-checkout pattern remains; workflow syntax validates.

- [ ] **Step 5: Run focused verification**

  ```bash
  bun run typecheck
  ```

  Expected: pass.

- [ ] **Step 6: Commit**

  ```bash
  git add .github/actions/setup-bun-monorepo/action.yml .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/build-binaries.yml .docs/repo-infrastructure.md
  git commit -m "ci: fix shared setup action checkout order"
  ```

---

## Task 2: Fix Diagnostics Level Semantics So Benign Skips Do Not Become Issues

**Files:**

- Modify: `apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts`
- Modify: `apps/cli/test/unit/services/diagnostics/diagnostic-event-helpers.test.ts`
- Modify: `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`
- Review: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Review: `apps/cli/src/app-shell/workflows/shell-workflows.ts`
- Review: `apps/cli/src/services/download/DownloadIntentService.ts`

**Interfaces:**

- Consumes: `buildDiagnosticEvent(input)` and subsystem helpers.
- Produces: diagnostic events where default `level` is derived from both lifecycle `status` and user-visible `severity`.

- [ ] **Step 1: Write failing tests for healthy skipped events**

  Add tests to `apps/cli/test/unit/services/diagnostics/diagnostic-event-helpers.test.ts`:

  ```ts
  test("does not turn healthy skipped events into warnings", () => {
    const event = buildSubtitleDiagnosticEvent({
      operation: "subtitle.lookup.skipped",
      status: "skipped",
      severity: "healthy",
      recommendedAction: "wait",
      message: "Late subtitle lookup skipped (already in flight)",
      context: { reason: "already-in-flight" },
    });

    expect(event.level).toBe("info");
    expect(event.context?.status).toBe("skipped");
    expect(event.context?.severity).toBe("healthy");
  });

  test("keeps blocked skipped events visible as errors", () => {
    const event = buildDownloadDiagnosticEvent({
      operation: "download.enqueue.blocked",
      status: "skipped",
      severity: "blocked",
      recommendedAction: "open-settings",
      message: "Download enqueue blocked by feature gate",
    });

    expect(event.level).toBe("error");
  });
  ```

- [ ] **Step 2: Write failing support-bundle triage regression**

  In `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`, add:

  ```ts
  test("event-only triage ignores healthy skipped events", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "test",
      debug: false,
      events: [
        {
          timestamp: 1,
          level: "info",
          category: "subtitle",
          operation: "subtitle.lookup.skipped",
          message: "Late subtitle lookup skipped (already in flight)",
          context: {
            status: "skipped",
            severity: "healthy",
            recommendedAction: "wait",
          },
        },
      ],
      now: () => new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(bundle.triage.verdict).toBe("Healthy");
    expect(bundle.triage.recommendedActions).toEqual(["none"]);
  });
  ```

- [ ] **Step 3: Run focused tests and confirm failure**

  ```bash
  bun run --cwd apps/cli test unit/services/diagnostics/diagnostic-event-helpers.test.ts unit/services/diagnostics/support-bundle.test.ts
  ```

  Expected before implementation: the healthy skipped event incorrectly has `level: "warn"` or bundle triage reports `Needs attention`.

- [ ] **Step 4: Implement severity-aware level mapping**

  In `diagnostic-event-helpers.ts`, replace `levelForStatus(status)` with a helper that receives both status and severity:

  ```ts
  function levelForEnvelope(
    status: DiagnosticEventStatus | undefined,
    severity: DiagnosticSeverity | undefined,
  ): DiagnosticEventInput["level"] {
    if (status === "progress") return "debug";
    if (status === "failed" || status === "timed-out") return "error";

    if (severity === "blocked") return "error";
    if (severity === "degraded" || severity === "recoverable") return "warn";

    return "info";
  }
  ```

  Then use it in `buildDiagnosticEvent`:

  ```ts
  level: input.level ?? levelForEnvelope(input.status, input.severity),
  ```

  Delete the old `levelForStatus` helper.

- [ ] **Step 5: Audit existing skipped/cancelled call sites**

  Review the current matches:

  ```bash
  rg -n "status: \"skipped\"|status: \"cancelled\"|status: \"timed-out\"|status: \"failed\"" apps/cli/src apps/cli/test
  ```

  Expected classification:

  - "already in flight" or "not applicable" skip: `severity: "healthy"` and `level: "info"`.
  - disabled feature, blocked download, missing dependency: `severity: "blocked"` and `level: "error"`.
  - user-visible degraded condition: `severity: "degraded"` or `"recoverable"` and `level: "warn"`.
  - real failed/timed-out operation: `level: "error"`.

- [ ] **Step 6: Run focused verification**

  ```bash
  bun run --cwd apps/cli test unit/services/diagnostics/diagnostic-event-helpers.test.ts unit/services/diagnostics/support-bundle.test.ts unit/services/diagnostics/diagnostics-insight.test.ts
  ```

  Expected: pass.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts apps/cli/test/unit/services/diagnostics/diagnostic-event-helpers.test.ts apps/cli/test/unit/services/diagnostics/support-bundle.test.ts
  git commit -m "fix: derive diagnostic event levels from severity"
  ```

---

## Task 3: Make Download And Notification Correlation Real Or Remove The Fake API

**Files:**

- Modify: `apps/cli/src/services/diagnostics/diagnostic-event.ts`
- Modify: `apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts`
- Modify: `apps/cli/src/services/diagnostics/support-bundle.ts`
- Modify: `apps/cli/test/unit/services/diagnostics/diagnostic-event-helpers.test.ts`
- Modify: `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`
- Review: `apps/cli/src/services/download/DownloadIntentService.ts`
- Review: `apps/cli/src/app-shell/workflows/shell-workflows.ts`

**Interfaces:**

- Consumes: `correlation: { downloadJobId, notificationId }` already passed by download/offline flows.
- Produces: first-class event fields and support-bundle correlation arrays for download and notification IDs.

- [ ] **Step 1: Write failing event helper test**

  In `diagnostic-event-helpers.test.ts`, add:

  ```ts
  test("promotes download and notification correlation ids", () => {
    const event = buildDownloadDiagnosticEvent({
      operation: "download.profile.confirmed",
      status: "succeeded",
      severity: "healthy",
      message: "Download intent job queued",
      correlation: {
        downloadJobId: "job-123",
        notificationId: "note-456",
      },
    });

    expect(event.downloadJobId).toBe("job-123");
    expect(event.notificationId).toBe("note-456");
  });
  ```

- [ ] **Step 2: Add fields to `DiagnosticEvent`**

  In `apps/cli/src/services/diagnostics/diagnostic-event.ts`, extend `DiagnosticEvent`:

  ```ts
  readonly downloadJobId?: string;
  readonly notificationId?: string;
  ```

  Keep them optional and redacted by the same event redaction path.

- [ ] **Step 3: Promote fields in `buildDiagnosticEvent`**

  In `diagnostic-event-helpers.ts`, add these keys to the returned object:

  ```ts
  downloadJobId: correlation.downloadJobId,
  notificationId: correlation.notificationId,
  ```

  Do not require callers to duplicate these IDs inside `context`.

- [ ] **Step 4: Extend support bundle correlation**

  In `support-bundle.ts`, extend `DiagnosticsBundleCorrelation` with:

  ```ts
  readonly downloadJobIds: readonly string[];
  readonly notificationIds: readonly string[];
  ```

  Extend `buildBundleCorrelation`:

  ```ts
  downloadJobIds: collectUnique(events, "downloadJobId"),
  notificationIds: collectUnique(events, "notificationId"),
  ```

  Extend `collectUnique`'s key union:

  ```ts
  key:
    | "sessionId"
    | "playbackCycleId"
    | "providerAttemptId"
    | "traceId"
    | "downloadJobId"
    | "notificationId"
  ```

  Extend `formatBundleCorrelationSummary` so it can include the first download job and notification IDs:

  ```ts
  correlation.downloadJobIds.length > 0 ? `download ${correlation.downloadJobIds[0]}` : null,
  correlation.notificationIds.length > 0 ? `notification ${correlation.notificationIds[0]}` : null,
  ```

- [ ] **Step 5: Add bundle regression test**

  In `support-bundle.test.ts`, add:

  ```ts
  test("includes download and notification correlation ids", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "test",
      debug: false,
      events: [
        {
          timestamp: 1,
          level: "info",
          category: "download",
          operation: "download.profile.confirmed",
          message: "Download queued",
          downloadJobId: "job-123",
          notificationId: "note-456",
        },
      ],
      now: () => new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(bundle.correlation.downloadJobIds).toEqual(["job-123"]);
    expect(bundle.correlation.notificationIds).toEqual(["note-456"]);
    expect(bundle.triage.correlationSummary).toContain("download job-123");
  });
  ```

- [ ] **Step 6: Run focused verification**

  ```bash
  bun run --cwd apps/cli test unit/services/diagnostics/diagnostic-event-helpers.test.ts unit/services/diagnostics/support-bundle.test.ts
  ```

  Expected: pass.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/cli/src/services/diagnostics/diagnostic-event.ts apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts apps/cli/src/services/diagnostics/support-bundle.ts apps/cli/test/unit/services/diagnostics/diagnostic-event-helpers.test.ts apps/cli/test/unit/services/diagnostics/support-bundle.test.ts
  git commit -m "fix: preserve diagnostics job correlation ids"
  ```

---

## Task 4: Deepen Diagnostics Insight And Support Bundle Analysis

**Files:**

- Modify: `apps/cli/src/services/diagnostics/diagnostics-insight.ts`
- Modify: `apps/cli/src/app-shell/diagnostics-panel-lines.ts`
- Modify: `apps/cli/src/services/diagnostics/support-bundle.ts`
- Modify: `apps/cli/test/unit/services/diagnostics/diagnostics-insight.test.ts`
- Modify: `apps/cli/test/unit/app-shell/diagnostics-panel-lines.test.ts`
- Modify: `apps/cli/test/unit/app-shell/panel-data.test.ts`
- Docs: `.docs/diagnostics-guide.md`

**Interfaces:**

- Consumes: raw `DiagnosticEvent[]`, current `SessionState`, optional runtime/download/release/presence summaries.
- Produces: stable diagnostics insight with one verdict, health rows, current evidence, developer evidence, and support-bundle triage.

- [ ] **Step 1: Create an event-sequence checklist before editing**

  Manually inspect or add fixture-like test data for these sequences:

  - healthy playback with no issues.
  - provider timeline failed with timeout.
  - provider fallback recovered.
  - cache stale then fresh source unavailable using cached fallback.
  - subtitle lookup skipped because already in flight.
  - subtitle lookup empty.
  - download enqueue blocked by feature gate.
  - presence clear failed.
  - memory warning sample.
  - no session state, event-only support bundle.

  Expected: every sequence has either existing test coverage or a new test in this task.

- [ ] **Step 2: Add tests for action priority**

  In `diagnostics-insight.test.ts`, ensure recommended actions are deterministic:

  ```ts
  test("prioritizes provider fallback over generic export when provider timeout is current cause", () => {
    const insight = buildDiagnosticsInsight({
      state: baseSessionState({ provider: "vidking" }),
      recentEvents: [
        diagnosticEvent({
          category: "provider",
          operation: "provider.resolve.timeline",
          level: "warn",
          providerId: "vidking",
          message: "VidKing timed out",
          context: {
            status: "failed",
            severity: "recoverable",
            failureClass: "timeout",
            primaryFailure: "timeout",
          },
        }),
      ],
    });

    expect(insight.sessionVerdict.primaryAction).toBe("fallback-provider");
    expect(insight.likelyCause).toContain("vidking");
  });
  ```

  Use existing test helpers in that file for `baseSessionState`/`diagnosticEvent`; if they do not exist, create small local helpers instead of importing runtime containers.

- [ ] **Step 3: Add panel line tests for section stability**

  In `diagnostics-panel-lines.test.ts`, assert:

  ```ts
  expect(lines.map((line) => line.label)).toEqual(
    expect.arrayContaining([
      "─── Verdict",
      "Verdict",
      "─── Health",
      "Playback",
      "Provider",
      "Network",
      "Cache",
      "Subtitles",
      "Downloads",
      "Discord",
      "Release sync",
      "Memory",
      "─── Current Playback Evidence",
      "─── Developer Evidence",
      "─── Export And Report",
    ]),
  );
  ```

  Also assert no raw URL/token appears:

  ```ts
  expect(JSON.stringify(lines)).not.toContain("token=");
  expect(JSON.stringify(lines)).not.toContain(process.env.HOME ?? "__no_home__");
  ```

- [ ] **Step 4: Fix insight logic only where tests expose drift**

  Keep all interpretation in `diagnostics-insight.ts`. `diagnostics-panel-lines.ts` should map model fields to `ShellPanelLine[]` only.

  Acceptable changes:

  - action ordering helper such as `rankRecommendedAction(action)`.
  - event lookup helper that searches newest-first when "current cause" matters.
  - stable subsystem ordering array.
  - explicit `unknown` reasons when evidence is missing.

  Avoid:

  - duplicating provider/cache/subtitle interpretation in panel rendering.
  - reading container state from diagnostics services.
  - exposing raw context directly in UI rows.

- [ ] **Step 5: Update diagnostics docs after behavior is verified**

  In `.docs/diagnostics-guide.md`, document only confirmed behavior:

  - section names.
  - health row grammar.
  - local durable sink.
  - support-bundle triage fields.
  - `downloadJobId`/`notificationId` correlation if Task 3 kept them.

- [ ] **Step 6: Run focused verification**

  ```bash
  bun run --cwd apps/cli test unit/services/diagnostics/diagnostics-insight.test.ts unit/services/diagnostics/support-bundle.test.ts unit/app-shell/diagnostics-panel-lines.test.ts unit/app-shell/panel-data.test.ts
  ```

  Expected: pass.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/cli/src/services/diagnostics/diagnostics-insight.ts apps/cli/src/app-shell/diagnostics-panel-lines.ts apps/cli/src/services/diagnostics/support-bundle.ts apps/cli/test/unit/services/diagnostics/diagnostics-insight.test.ts apps/cli/test/unit/services/diagnostics/support-bundle.test.ts apps/cli/test/unit/app-shell/diagnostics-panel-lines.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts .docs/diagnostics-guide.md
  git commit -m "test: harden diagnostics insight triage"
  ```

---

## Task 5: Add Render-Capture Coverage For Media Panel, Loading, And Post-Play UI States

**Files:**

- Modify: `apps/cli/test/unit/app-shell/post-play-shell.test.tsx`
- Create or Modify: `apps/cli/test/unit/app-shell/media-panel.test.tsx`
- Create or Modify: `apps/cli/test/unit/app-shell/loading-shell.test.tsx` if an appropriate shell render test already exists, extend it instead.
- Review: `apps/cli/src/app-shell/MediaPanel.tsx`
- Review: `apps/cli/src/app-shell/loading-shell.tsx`
- Review: `apps/cli/src/app-shell/post-play-shell.tsx`
- Docs: `apps/cli/test/README.md` only if test guidance changes.

**Interfaces:**

- Consumes: `buildMediaPanel(...)` model and `MediaPanel` renderer.
- Produces: render-capture proof that the new wide rail and state transitions mount without layout regression.

- [ ] **Step 1: Add direct `MediaPanel` capture tests**

  Create `apps/cli/test/unit/app-shell/media-panel.test.tsx`:

  ```tsx
  import { describe, expect, test } from "bun:test";
  import React from "react";

  import { MediaPanel } from "@/app-shell/MediaPanel";
  import { buildMediaPanel } from "@/app-shell/media-panel-model";

  import { captureFrame } from "../../harness/render-capture";

  describe("MediaPanel render", () => {
    test("renders series details, synopsis, previous, up next, and progress", () => {
      const model = buildMediaPanel({
        surface: "post-play",
        contentKind: "series",
        title: "The Apothecary Diaries",
        currentSeason: 1,
        currentEpisode: 11,
        previousEpisodeLabel: "S01 E10 — Verdigris",
        nextEpisodeLabel: "S01 E12 — Inversion",
        posterUrl: "https://img/poster.jpg",
        progress: { watched: 11, total: 24 },
        titleDetail: {
          id: "1",
          type: "series",
          title: "The Apothecary Diaries",
          year: "2024",
          synopsis: "Maomao, an apothecary, is sold into the imperial palace.",
          genres: ["Drama"],
          score: 8.6,
          episodeCount: 24,
          artwork: { poster: "https://img/poster.jpg" },
        },
      });

      const frame = captureFrame(<MediaPanel model={model} railWidth={36} active={false} />, {
        columns: 140,
      });

      expect(frame).toContain("anime").not.toBeTruthy(); // Delete this line if contentKind remains series.
      expect(frame).toContain("series");
      expect(frame).toContain("The Apothecary Diaries");
      expect(frame).toContain("details");
      expect(frame).toContain("synopsis");
      expect(frame).toContain("prev");
      expect(frame).toContain("up next");
      expect(frame).toContain("E10");
      expect(frame).toContain("E12");
      expect(frame).not.toContain("anime");
    });
  });
  ```

- [ ] **Step 2: Add post-play rail assertions**

  Extend `post-play-shell.test.tsx` with:

  ```tsx
  it("wide rail renders the shared media panel with previous and up-next cards", () => {
    const frame = captureFrame(
      <PostPlayShell
        title="My Show"
        episodeLabel="S01 E11"
        previousEpisodeLabel="S01 E10 — Before"
        nextEpisodeLabel="S01 E12 — Next One"
        currentSeason={1}
        currentEpisode={11}
        totalEpisodes={24}
        watchedEpisodes={11}
        contentKind="series"
        postPlayState={{ kind: "mid-series" }}
      />,
      { columns: 140 },
    );

    expect(frame).toContain("prev");
    expect(frame).toContain("up next");
    expect(frame).toContain("E10");
    expect(frame).toContain("E12");
    expect(frame).toContain("11%");
  });
  ```

  If progress renders as `46%` for 11/24, use the actual expected percentage from the `buildProgress` helper.

- [ ] **Step 3: Add loading shell side-panel coverage**

  Find the existing `LoadingShell` render test if present:

  ```bash
  rg -n "LoadingShell" apps/cli/test/unit/app-shell
  ```

  Add a capture for wide bootstrap with panel content:

  ```tsx
  const frame = captureFrame(
    <LoadingShell
      state={{
        operation: "provider-resolve",
        title: "Dune",
        stage: "provider",
        startedAt: Date.now(),
        posterUrl: "https://img/poster.jpg",
        titleDetail: {
          id: "438631",
          type: "movie",
          title: "Dune",
          year: "2021",
          runtimeMinutes: 155,
          synopsis: "Paul Atreides arrives on Arrakis.",
        },
      }}
    />,
    { columns: 140, rows: 40 },
  );
  expect(frame).toContain("Dune");
  expect(frame).toContain("details");
  ```

  Match the real `LoadingShellState` shape instead of adding `as any`. If the component requires many callbacks, create a local `baseLoadingState()` test helper with typed defaults.

- [ ] **Step 4: Add width regression assertions**

  For media/post-play/loading tests, cover:

  - `columns: 140`: side panel visible.
  - `columns: 90`: side panel collapsed or still legible depending on current breakpoint.
  - `columns: 72`: primary workflow remains usable.
  - too-small columns show resize blocker where the surface owns one.

- [ ] **Step 5: Verify there are no raw color/token violations**

  Search the new UI files:

  ```bash
  rg -n "#[0-9a-fA-F]{3,8}|amber|pink|teal|cyan|lavender|purple|yellow|green|red" apps/cli/src/app-shell/MediaPanel.tsx apps/cli/src/app-shell/SakuraLoader.tsx apps/cli/src/app-shell/primitives/SakuraPetal.tsx
  ```

  Expected: no new raw hex; color usage should go through `palette`/semantic helpers. Existing deprecated aliases may appear only if already part of `palette` compatibility, not as new direct style decisions.

- [ ] **Step 6: Run focused UI tests**

  ```bash
  bun run --cwd apps/cli test unit/app-shell/media-panel.test.tsx unit/app-shell/media-panel-model.test.ts unit/app-shell/post-play-shell.test.tsx unit/app-shell/help-scope.test.ts unit/app-shell/interactive-shell-state.test.ts
  ```

  Expected: pass.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/cli/src/app-shell/MediaPanel.tsx apps/cli/src/app-shell/media-panel-model.ts apps/cli/src/app-shell/media-art.ts apps/cli/src/app-shell/loading-shell.tsx apps/cli/src/app-shell/post-play-shell.tsx apps/cli/test/unit/app-shell/media-panel.test.tsx apps/cli/test/unit/app-shell/media-panel-model.test.ts apps/cli/test/unit/app-shell/post-play-shell.test.tsx apps/cli/test/unit/app-shell/help-scope.test.ts apps/cli/test/unit/app-shell/interactive-shell-state.test.ts
  git commit -m "test: cover shared media panel shell states"
  ```

---

## Task 6: Sweep Unchecked Runtime State And UI Edge Cases

**Files:**

- Review/Modify: `apps/cli/src/domain/session/SessionState.ts`
- Review/Modify: `apps/cli/src/app-shell/root-shell-state.ts`
- Review/Modify: `apps/cli/src/app-shell/types.ts`
- Review/Modify: `apps/cli/src/app-shell/playback-mount-shell.tsx`
- Review/Modify: `apps/cli/src/app/playback/run-post-playback-menu.ts`
- Review/Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Review/Modify: `apps/cli/src/app/search/SearchPhase.ts`
- Tests: `apps/cli/test/unit/domain/session/SessionState.test.ts`
- Tests: `apps/cli/test/unit/app-shell/interactive-shell-state.test.ts`

**Interfaces:**

- Consumes: session transitions such as `SELECT_TITLE`, `SET_TITLE_DETAIL`, `SELECT_EPISODE`, `SET_STREAM`, playback/post-play state builders.
- Produces: clear reset rules so stale media metadata, video metadata, previous/next labels, title detail, and playback feedback do not leak across titles or modes.

- [ ] **Step 1: Map every new state field and reset point**

  Build a checklist from these fields:

  - `SessionState.titleDetail`
  - `SessionState.videoMeta`
  - `LoadingShellState.contentKind`
  - `LoadingShellState.videoMeta`
  - `LoadingShellState.previousEpisodeLabel`
  - `LoadingShellState.previousEpisodeThumbUrl`
  - `PostPlayShellProps.contentKind`
  - `PostPlayShellProps.videoMeta`
  - `PostPlayShellProps.previousEpisodeLabel`
  - `PostPlayShellProps.previousEpisodeThumbUrl`

  For each field, identify:

  - where it is set.
  - where it is cleared.
  - whether it can survive a title/mode/provider switch.
  - which tests prove that behavior.

- [ ] **Step 2: Add state reset tests**

  In `SessionState.test.ts`, add cases like:

  ```ts
  test("SELECT_TITLE clears stale title detail when switching titles", () => {
    const state = reduceSessionState(
      reduceSessionState(initialSessionState(), {
        type: "SET_TITLE_DETAIL",
        titleId: "old",
        titleType: "series",
        detail: { id: "old", type: "series", title: "Old Title" },
      }),
      {
        type: "SELECT_TITLE",
        title: { id: "new", type: "movie", name: "New Title" },
      },
    );

    expect(state.titleDetail).toBeNull();
    expect(state.videoMeta).toBeNull();
  });
  ```

  Match the actual reducer function names in `SessionState.ts`.

- [ ] **Step 3: Add stale async detail guard test**

  Ensure `SET_TITLE_DETAIL` only applies when `titleId` and `titleType` match `currentTitle`:

  ```ts
  test("SET_TITLE_DETAIL ignores stale async detail for a previous title", () => {
    const state = reduceSessionState(
      reduceSessionState(initialSessionState(), {
        type: "SELECT_TITLE",
        title: { id: "new", type: "movie", name: "New Title" },
      }),
      {
        type: "SET_TITLE_DETAIL",
        titleId: "old",
        titleType: "series",
        detail: { id: "old", type: "series", title: "Old Title" },
      },
    );

    expect(state.titleDetail).toBeNull();
  });
  ```

- [ ] **Step 4: Check playback/post-play state construction**

  Review:

  ```bash
  rg -n "previousEpisodeLabel|previousEpisodeThumbUrl|contentKind|videoMeta|titleDetail" apps/cli/src/app-shell apps/cli/src/app/playback apps/cli/src/domain/session
  ```

  Confirm:

  - movie post-play does not infer `series` solely because `episodeLabel` is non-empty if the caller knows `contentKind: "movie"`.
  - video/youtube post-play uses `videoMeta` and does not show season/episode facts.
  - title detail async warm does not overwrite another title.
  - previous/next episode labels come from provider/catalog navigation, not guessed numbers.

- [ ] **Step 5: Implement only the reset/guard fixes the tests require**

  Preferred reducer behavior:

  ```ts
  case "SELECT_TITLE":
    return {
      ...state,
      currentTitle: transition.title,
      titleDetail: null,
      videoMeta: transition.videoMeta ?? deriveVideoMetaForTitle(state.searchResults, transition.title.id),
      episodeNavigation: emptyEpisodeNavigation(),
      stream: null,
      playbackProblem: null,
    };

  case "SET_TITLE_DETAIL":
    if (
      !state.currentTitle ||
      state.currentTitle.id !== transition.titleId ||
      state.currentTitle.type !== transition.titleType
    ) {
      return state;
    }
    return { ...state, titleDetail: transition.detail };
  ```

  Use the actual helper names already present in the file.

- [ ] **Step 6: Run focused state tests**

  ```bash
  bun run --cwd apps/cli test unit/domain/session/SessionState.test.ts unit/app-shell/interactive-shell-state.test.ts
  ```

  Expected: pass.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/cli/src/domain/session/SessionState.ts apps/cli/src/app-shell/root-shell-state.ts apps/cli/src/app-shell/types.ts apps/cli/src/app-shell/playback-mount-shell.tsx apps/cli/src/app/playback/run-post-playback-menu.ts apps/cli/test/unit/domain/session/SessionState.test.ts apps/cli/test/unit/app-shell/interactive-shell-state.test.ts
  git commit -m "fix: guard media panel session state resets"
  ```

---

## Task 7: Verify Packaging And Build Pipeline Without Trusting Local Assumptions

**Files:**

- Modify: `apps/cli/scripts/build.ts`
- Modify: `apps/cli/scripts/build-shared.ts`
- Modify: `apps/cli/scripts/verify-npm-pack.ts`
- Modify: `scripts/verify-build-pipeline.ts`
- Modify: `apps/cli/package.json`
- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `apps/cli/.npmignore`
- Tests: `apps/cli/test/unit/scripts/verify-npm-pack.test.ts`
- Tests: `apps/cli/test/integration/npm-pack-guard.test.ts`
- Docs: `.docs/repo-infrastructure.md`, `.docs/release-reliability-gate.md`, `RELEASING.md`

**Interfaces:**

- Consumes: build artifacts under `apps/cli/dist`.
- Produces: npm tarball allowlist and binary build outputs that can coexist on disk without shipping compiled binaries to npm.

- [ ] **Step 1: Run focused packaging tests**

  ```bash
  bun run --cwd apps/cli test unit/scripts/verify-npm-pack.test.ts integration/npm-pack-guard.test.ts
  ```

  Expected: pass.

- [ ] **Step 2: Run local package guard against real `npm pack` output**

  ```bash
  bun run --cwd apps/cli pkg:check
  ```

  Expected:

  - output includes `[pkg:check] ok`.
  - output does not list `dist/bin/`.
  - output does not list `*.meta.json`.

- [ ] **Step 3: Verify `build` does not delete host/release binaries unexpectedly**

  Run:

  ```bash
  bun run build
  bun run pkg:check
  ```

  Expected:

  - `apps/cli/dist/kunai.js` exists.
  - host binary exists if the host binary task ran.
  - `pkg:check` still excludes `dist/bin/**`.
  - no build-analyze metafile ships.

- [ ] **Step 4: Verify Turbo output declarations**

  Inspect `turbo.json` and confirm:

  - `build` outputs only npm bundle/assets/build metadata and docs `.next`.
  - `build:binary:host` outputs `dist/bin/kunai-*`, `dist/bin/SHA256SUMS`, and binary metafiles.
  - `build:binaries` outputs `dist/bin/**`.
  - env includes `KUNAI_BUILD_ANALYZE` where it affects output.

- [ ] **Step 5: Run fast build-pipeline verifier**

  ```bash
  bun run verify:build-pipeline
  ```

  Expected: typecheck, build, pkg check, cache-hit check, and host binary check pass. If cache-hit check is too brittle locally, change the verifier to report misses as a warning only when the preceding build commands succeeded, and add a test or code comment explaining why.

- [ ] **Step 6: Optionally run PR parity verifier**

  This is heavier. Run only when disk/time permits:

  ```bash
  bun run verify:build-pipeline:pr
  ```

  Expected: linux glibc + musl binary build and partial binary verification pass.

- [ ] **Step 7: Update docs to match verified commands**

  Update `.docs/repo-infrastructure.md`, `.docs/release-reliability-gate.md`, and `RELEASING.md` only with commands actually verified in this task.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/cli/scripts/build.ts apps/cli/scripts/build-shared.ts apps/cli/scripts/verify-npm-pack.ts scripts/verify-build-pipeline.ts apps/cli/package.json package.json turbo.json apps/cli/.npmignore apps/cli/test/unit/scripts/verify-npm-pack.test.ts apps/cli/test/integration/npm-pack-guard.test.ts .docs/repo-infrastructure.md .docs/release-reliability-gate.md RELEASING.md
  git commit -m "build: verify npm and binary artifact split"
  ```

---

## Task 8: Final Deep Sweep Across Unseen Parts

**Files:**

- Review all unstaged files from `git status --short`.
- Update docs only where code truth changed.
- Review: `docs/superpowers/plans/2026-06-27-unstaged-authority-map.md`

**Interfaces:**

- Consumes: completed Tasks 1-7.
- Produces: final confidence report and cleanly scoped remaining follow-ups.

- [ ] **Step 1: Re-list dirty tree and group by subsystem**

  ```bash
  git status --short
  git diff --stat
  ```

  Group remaining changes into:

  - CI/release/package.
  - diagnostics/observability.
  - shell UI/media panel/help states.
  - playback/player/provider behavior.
  - docs/generated metadata.
  - unrelated leftovers.

- [ ] **Step 2: Search for known antipatterns**

  ```bash
  rg -n "console\\.log|TODO|TBD|as any|eslint-disable|process\\.env\\.|http://|https://|token|cookie|authorization" apps/cli/src apps/cli/test .github scripts docs/superpowers/specs .docs RELEASING.md
  ```

  Expectations:

  - No `console.log` inside Ink render paths.
  - Any `eslint-disable` has a narrow, justified comment.
  - No raw token/cookie/header values in docs/tests.
  - URLs in tests are placeholders and redaction tests prove they are not emitted raw.
  - `process.env` in release builds is not inlined into artifacts.

- [ ] **Step 3: Re-run duplicate-truth searches from the authority map**

  Re-run:

  ```bash
  rg -n "buildDiagnosticsPanelLines|buildDiagnosticsInsight|formatHealthStatusLabel|formatRecommendedActionLabel|buildMediaPanel|buildPlaybackPlayingRailView|resolveSeasonAwarePosterUrl|resolveEpisodeThumbUrl|helpSectionsForScope|setup-bun-monorepo|verify-npm-pack|pkg:check" apps/cli/src apps/cli/test .github scripts package.json turbo.json .docs docs/superpowers/specs RELEASING.md
  ```

  Update `docs/superpowers/plans/2026-06-27-unstaged-authority-map.md` if ownership changed during execution.

  Expected:

  - No resurrected `buildPlaybackPlayingRailView` production dependency.
  - No second diagnostics triage formatter outside `diagnostics-insight.ts`.
  - No second artwork fallback chain outside `media-art.ts`.
  - No per-workflow Bun install/cache copy drift.
  - Docs describe verified source-of-truth modules rather than becoming another policy engine.

- [ ] **Step 4: Search for UI design drift**

  ```bash
  rg -n "#[0-9a-fA-F]{3,8}|amber|pink|teal|cyan|lavender|purple|yellow|green|red|borderColor=|borderStyle=" apps/cli/src/app-shell
  ```

  Expectations:

  - New UI code uses `palette` and semantic state helpers.
  - No nested full-width card stacks.
  - Side panels collapse before primary content.
  - Missing artwork has honest placeholders and does not shift layout.

- [ ] **Step 5: Run focused subsystem tests**

  ```bash
  bun run --cwd apps/cli test unit/services/diagnostics/diagnostic-event-helpers.test.ts unit/services/diagnostics/diagnostics-insight.test.ts unit/services/diagnostics/support-bundle.test.ts unit/services/diagnostics/DurableDiagnosticsSink.test.ts
  bun run --cwd apps/cli test unit/app-shell/media-panel-model.test.ts unit/app-shell/media-panel.test.tsx unit/app-shell/post-play-shell.test.tsx unit/app-shell/help-scope.test.ts unit/app-shell/diagnostics-panel-lines.test.ts
  bun run --cwd apps/cli test unit/domain/session/SessionState.test.ts unit/services/playback/playback-resolve-coordinator.test.ts unit/scripts/verify-npm-pack.test.ts integration/npm-pack-guard.test.ts
  ```

  Expected: all pass.

- [ ] **Step 6: Run full repo gates**

  ```bash
  bun run typecheck
  bun run lint
  bun run fmt
  bun run test
  ```

  Expected: all pass. If `fmt` is a write command in this repo rather than check-only, inspect the diff it creates and commit only intended formatting changes.

- [ ] **Step 7: Run build gate**

  ```bash
  bun run build
  bun run pkg:check
  ```

  Expected: build and package check pass. Run `bun run verify:build-pipeline` if Task 7 did not already run it after all changes.

- [ ] **Step 8: Produce final review notes**

  Summarize:

  - what was fixed.
  - what deeper analysis found.
  - which modules now own each source of truth.
  - which duplicate-truth candidates were deleted, merged, or intentionally kept.
  - what was explicitly checked and not changed.
  - remaining risks, if any.
  - exact verification commands and results.

- [ ] **Step 9: Commit final docs or test-only cleanup if needed**

  If Task 8 produces only docs/test cleanup:

  ```bash
  git add <specific files>
  git commit -m "test: close unstaged review verification gaps"
  ```

  Do not squash unrelated subsystems together unless the user asks.

---

## Best-Code-Quality Expectations

- The fix for CI should be boring and explicit: checkout first, setup second.
- Diagnostics event builders should not hide policy in ambiguous names. `status` is lifecycle, `severity` is user impact, `level` is logging priority.
- Support bundles should be useful without the UI, but should never become a secret dump.
- The app shell should render prepared state models, not infer runtime truth from raw events.
- UI changes should be proven with model tests plus render-capture tests at multiple widths.
- Reducers/state transitions must clear stale rich metadata on title/mode changes.
- Tests should assert behavior and contracts, not internal implementation trivia.
- Docs should follow verified code behavior, not desired behavior.

## Assumptions To Validate During Execution

- `actions/cache@v5` and `actions/checkout@v5` are valid in the current GitHub Actions ecosystem. If not, use the repo-supported latest major consistently.
- The current dirty tree intentionally includes CI/release, diagnostics, shell UI, packaging, and docs changes; do not discard them as unrelated without asking.
- `bun run fmt` is one of the repo's required finish gates; if it writes files, review and include only relevant formatting.
- Full binary verification may be expensive; `verify:build-pipeline:pr` is enough for PR parity unless release/all-targets work is explicitly required.
- Render-capture tests may need exact strings adjusted to current glyphs/copy, but they must still prove the panel state exists and stays legible.

## Dependency Order

1. Task 0 first: it prevents multi-source-of-truth fixes and gives every worker the same ownership map.
2. Task 1 next: broken CI blocks all remote confidence.
3. Task 2 before Task 4: diagnostics triage depends on correct event levels.
4. Task 3 before Task 4: bundle correlation should be real before triage docs/tests lock it.
5. Task 5 and Task 6 can run after Task 0 and Task 2; they are mostly UI/state but must use the authority map.
6. Task 7 can run in parallel after Task 1, but final package docs should wait for verification.
7. Task 8 always last.

## Self-Review

- Spec coverage: authority mapping, duplicate-truth prevention, CI bootstrap, diagnostics false positives, correlation contract, UI/media state coverage, state reset checks, packaging, docs, and final verification are all assigned to tasks.
- Placeholder scan: no step uses TBD/TODO/fill-in wording. Where exact strings may differ, the plan requires matching current typed shapes rather than `as any`.
- Type consistency: `DiagnosticEvent`, `DiagnosticCorrelation`, `DiagnosticsBundleCorrelation`, `buildDiagnosticEvent`, `build*DiagnosticEvent`, `MediaPanel`, and `buildMediaPanel` names match current files.
