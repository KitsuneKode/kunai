# First-Run and Offline Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let setup and non-playback surfaces work without mpv, keep `/library` local-only with single-owner input, make opener failures recoverable, report Linux-only protocol registration honestly, and add an opt-in offline beta smoke.

**Architecture:** Startup capability detection is informational; playback performs a dynamic dependency gate. `/library` derives rows only from offline artifacts and delegates each visible surface to one active input handler. URL/folder opening returns typed infra results whose callers render copyable fallbacks.

**Tech Stack:** Bun, TypeScript, React 19, Ink 7, SQLite services, render-capture harness.

## Global Constraints

- Do not rewrite the download worker or offline service.
- Watchlist-only rows are omitted from `/library`.
- Missing mpv blocks playback only.
- Protocol registration is Linux-only for 0.3.0.
- Offline reality checks are opt-in and outside default CI.
- Preserve unrelated working-tree paths.

---

### Task 1: Mount setup/shell without mpv and gate playback

**Files:**

- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/ui.ts`
- Create: `apps/cli/src/app/playback/playback-dependency-gate.ts`
- Modify: `apps/cli/src/domain/playback/playback-problem.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/app-shell/setup-shell.tsx`
- Create/modify focused tests

**Interfaces:**

```ts
export interface DependencyRemediation {
  readonly platform: "linux" | "darwin" | "win32" | "other";
  readonly summary: string;
  readonly commands: readonly string[];
  readonly helpUrl?: string;
}

export function buildMpvRemediation(platform?: NodeJS.Platform): DependencyRemediation;

export async function gatePlaybackDependencies(input: {
  readonly player: { isAvailable(): Promise<boolean> };
  readonly platform?: NodeJS.Platform;
}): Promise<
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly dependency: "mpv";
      readonly problem: PlaybackProblem;
      readonly remediation: DependencyRemediation;
    }
>;
```

- [ ] **Step 1: Add remediation/gate tests**

```ts
test("missing mpv blocks playback with Linux guidance", async () => {
  const result = await gatePlaybackDependencies({
    player: { isAvailable: async () => false },
    platform: "linux",
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected blocked playback");
  expect(result.problem.cause).toBe("mpv-missing");
  expect(result.problem.userMessage).toContain("apt install mpv");
});
```

Test macOS `brew install mpv` and Windows `winget install --id mpv.net -e`.

- [ ] **Step 2: Add mounted setup test**

```tsx
test("setup advances when mpv is missing", () => {
  const handle = render(<SetupShell snapshot={MISSING_MPV} finish={() => {}} />, {
    columns: 100,
    rows: 40,
  });
  handle.stdin.enqueue("\r");
  expect(handle.lastFrame()).toContain("System check");
  expect(handle.lastFrame()).toContain("continue anyway");
  handle.stdin.enqueue("\r");
  expect(handle.lastFrame()).toContain("Audio preference");
});
```

- [ ] **Step 3: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback-dependency-gate.test.ts \
  test/unit/app/playback-problem.test.ts \
  test/unit/app-shell/setup-without-mpv.useinput.test.tsx
```

- [ ] **Step 4: Remove startup exit and gate early in PlaybackPhase**

Delete the unconditional missing-mpv exit. Call the dependency gate before episode/provider/history work; on failure record diagnostics and return to results. Keep launch-time availability checks as race protection.

- [ ] **Step 5: Prove provider/history are untouched**

Add a boundary test asserting `providerResolveCalls === 0` and `historyCheckpointStarts === 0` when mpv is unavailable.

- [ ] **Step 6: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback-dependency-gate.test.ts \
  test/unit/app/playback-problem.test.ts \
  test/unit/app-shell/setup-without-mpv.useinput.test.tsx
bun run typecheck
git add apps/cli/src/main.ts apps/cli/src/ui.ts \
  apps/cli/src/app/playback/playback-dependency-gate.ts \
  apps/cli/src/domain/playback/playback-problem.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/src/app-shell/setup-shell.tsx \
  apps/cli/test/unit/app/playback-dependency-gate.test.ts \
  apps/cli/test/unit/app/playback-problem.test.ts \
  apps/cli/test/unit/app-shell/setup-without-mpv.useinput.test.tsx
git commit -m "fix(startup): gate playback instead of shell on missing mpv"
```

### Task 2: Keep Watchlist-only titles out of `/library`

**Files:**

- Create: `apps/cli/src/app-shell/library-shelf-model.ts`
- Modify: `apps/cli/src/app-shell/library-shell.tsx`
- Create: `apps/cli/test/unit/app-shell/library-shelf-model.test.ts`
- Modify: `apps/cli/test/unit/app-shell/library-repair.test.ts`

**Interfaces:**

```ts
export type LibraryShelfSectionId = "in-progress" | "downloaded" | "needs-attention";
export interface LibraryShelfRow {
  readonly kind: "offline";
  readonly group: OfflineLibraryShelfGroup;
}
export function buildLibraryShelfSections(input: {
  readonly groups: readonly OfflineLibraryShelfGroup[];
  readonly historyByTitle: Readonly<Record<string, HistoryProgress>>;
}): readonly LibraryShelfSection[];
```

- [ ] **Step 1: Add pure model tests**

```ts
test("empty offline groups produce no Watchlist rows", () => {
  expect(buildLibraryShelfSections({ groups: [], historyByTitle: {} })).toEqual([]);
});

test("broken artifacts remain in Needs attention", () => {
  expect(
    buildLibraryShelfSections({ groups: [BROKEN_GROUP], historyByTitle: {} })[0],
  ).toMatchObject({ id: "needs-attention" });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/library-shelf-model.test.ts \
  test/unit/app-shell/library-repair.test.ts
```

- [ ] **Step 3: Extract model and remove Watchlist dependency**

Delete Watchlist state, `listService.getWatchlist()`, `kind: "saved"`, saved sections, and saved-row formatting. Keep missing/invalid downloaded artifacts actionable.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/library-shelf-model.test.ts \
  test/unit/app-shell/library-repair.test.ts
bun run typecheck
git add apps/cli/src/app-shell/library-shelf-model.ts \
  apps/cli/src/app-shell/library-shell.tsx \
  apps/cli/test/unit/app-shell/library-shelf-model.test.ts \
  apps/cli/test/unit/app-shell/library-repair.test.ts
git commit -m "fix(library): keep watchlist-only titles out of offline library"
```

### Task 3: Give each library key one active owner

**Files:**

- Modify: `apps/cli/src/app-shell/library-shell.tsx`
- Modify: `apps/cli/src/app-shell/library-title-detail.tsx`
- Modify: `apps/cli/src/app-shell/download-manager-shell.tsx`
- Create: `apps/cli/test/unit/app-shell/library-input-ownership.useinput.test.tsx`

**Ownership:**

| Visible surface | Input owner              |
| --------------- | ------------------------ |
| title list      | `LibraryTab`             |
| title detail    | `LibraryTitleDetail`     |
| downloads queue | `DownloadManagerContent` |

- [ ] **Step 1: Add mounted exact-count tests**

```tsx
test("printable d filters once and does not toggle config", () => {
  const updates: unknown[] = [];
  const handle = render(<LibraryShell container={fixture({ updates })} onClose={() => {}} />);
  handle.stdin.enqueue("d");
  expect(handle.lastFrame()).toContain("Filter: d");
  expect(updates).toEqual([]);
});
```

Also test Enter disables parent handler, Tab navigates once, `l` returns once, and Esc closes/navigates exactly once.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/unit/app-shell/library-input-ownership.useinput.test.tsx
```

- [ ] **Step 3: Make ownership structural**

Remove parent `LibraryShell` input handling. Pass callbacks to the active child. Use `useInput(handler, { isActive })`; remove the undocumented `d` download toggle.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/library-input-ownership.useinput.test.tsx \
  test/unit/app-shell/library-repair.test.ts
bun run typecheck
git add apps/cli/src/app-shell/library-shell.tsx \
  apps/cli/src/app-shell/library-title-detail.tsx \
  apps/cli/src/app-shell/download-manager-shell.tsx \
  apps/cli/test/unit/app-shell/library-input-ownership.useinput.test.tsx
git commit -m "fix(library): give each mounted key one input owner"
```

### Task 4: Return typed opener failures and manual fallbacks

**Files:**

- Create: `apps/cli/src/infra/os/external-open.ts`
- Modify: `apps/cli/src/infra/shell/open-external-url.ts`
- Modify: `apps/cli/src/infra/os/reveal-in-file-manager.ts`
- Create: `apps/cli/src/app-shell/external-open-fallback.ts`
- Modify opener callers and tests

**Interfaces:**

```ts
export type ExternalOpenFailureReason =
  "disabled" | "unsupported-platform" | "opener-not-found" | "spawn-failed" | "non-zero-exit";

export type ExternalOpenResult =
  | { readonly ok: true; readonly command: readonly string[]; readonly target: ExternalOpenTarget }
  | {
      readonly ok: false;
      readonly reason: ExternalOpenFailureReason;
      readonly target: ExternalOpenTarget;
      readonly detail?: string;
    };
```

- [ ] **Step 1: Add platform-command and exception tests**

```ts
test("Linux uses only xdg-open", async () => {
  expect((await openExternalUrl("https://example.com", LINUX_RUNTIME)).command).toEqual([
    "/usr/bin/xdg-open",
    "https://example.com",
  ]);
});

test("spawn exception becomes typed failure", async () => {
  expect(await openExternalUrl("https://example.com", THROWING_RUNTIME)).toMatchObject({
    ok: false,
    reason: "spawn-failed",
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/infra/os/external-open.test.ts \
  test/unit/infra/shell/open-external-url.test.ts \
  test/unit/app-shell/external-open-fallback.test.ts
```

- [ ] **Step 3: Implement one platform-correct command**

Linux `xdg-open`; macOS `open`/`open -R`; Windows `cmd.exe ... start` or `explorer.exe /select,`. Convert sync spawn throws and rejected `exited` promises to typed results.

- [ ] **Step 4: Surface copyable targets**

Issue reporting shows issue URL and absolute bundle path. Folder reveal shows original path. Release/trailer/docs links show the complete URL.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/infra/os/external-open.test.ts \
  test/unit/infra/shell/open-external-url.test.ts \
  test/unit/app-shell/external-open-fallback.test.ts
git commit -m "fix(shell): surface typed opener failures with manual fallbacks"
```

Stage only the new infra/model files, modified callers, and matching tests.

### Task 5: Report protocol registration as Linux-only

**Files:**

- Modify: `apps/cli/src/infra/os/protocol-handler.ts`
- Modify: `apps/cli/src/cli-args.ts`
- Modify: `apps/cli/src/main.ts`
- Modify protocol/help tests

- [ ] **Step 1: Add unsupported-platform tests**

```ts
test.each(["darwin", "win32"] as const)("registration is unavailable on %s", (platform) => {
  const plan = buildProtocolHandlerInstallPlan({ platform });
  expect(plan.supported).toBe(false);
  expect(plan.writes).toEqual([]);
  expect(plan.commands).toEqual([]);
  expect(plan.notes.join(" ")).toContain("implemented on Linux only");
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/infra/os/protocol-handler.test.ts \
  test/unit/main-args.test.ts
```

- [ ] **Step 3: Fix runtime/help behavior**

Help says `Register the Linux kunai:// URL handler`. Unsupported runtime prints explicit notes, exits 1, and performs no write/spawn; dry-run remains inspectable.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/infra/os/protocol-handler.test.ts \
  test/unit/main-args.test.ts
bun run typecheck
git add apps/cli/src/infra/os/protocol-handler.ts \
  apps/cli/src/cli-args.ts apps/cli/src/main.ts \
  apps/cli/test/unit/infra/os/protocol-handler.test.ts \
  apps/cli/test/unit/main-args.test.ts
git commit -m "fix(protocol): report Linux-only registration honestly"
```

### Task 6: Add opt-in offline beta reality harness

**Files:**

- Create: `apps/cli/test/live/offline-beta.smoke.ts`
- Create: `apps/cli/test/live/offline-beta-smoke-report.ts`
- Create: `apps/cli/test/unit/live/offline-beta-smoke-report.test.ts`
- Modify: `apps/cli/package.json`
- Modify: `package.json`

**Interfaces:**

```ts
export type OfflineBetaSmokeCheckId =
  | "enqueue"
  | "cancel"
  | "shutdown-pause"
  | "restart-recovery"
  | "artifact-discovery"
  | "subtitle-sidecar"
  | "timing-metadata"
  | "local-playback-start"
  | "clean-shutdown";
```

- [ ] **Step 1: Add deterministic report completeness test**

```ts
test("report passes only with every required check exactly once", () => {
  expect(buildOfflineBetaSmokeReport(ALL_PASSING_CHECKS, "/tmp/profile").ok).toBe(true);
  expect(() => buildOfflineBetaSmokeReport(DUPLICATE_CHECKS, "/tmp/profile")).toThrow();
});
```

- [ ] **Step 2: Register opt-in commands**

```json
"test:live:offline-beta": "bun -e \"await import('./test/live/offline-beta.smoke.ts')\""
```

Root delegates with `bun run --cwd apps/cli test:live:offline-beta`.

- [ ] **Step 3: Implement explicit opt-in**

Require `KUNAI_OFFLINE_BETA_SMOKE=1`, `KUNAI_OFFLINE_SMOKE_MEDIA_URL`, and `KUNAI_OFFLINE_SMOKE_SUBTITLE_URL`; otherwise emit a skipped JSON result and exit zero.

- [ ] **Step 4: Implement real isolated sequence**

Create temporary XDG profile before imports; verify yt-dlp/ffprobe/mpv; enqueue/cancel; enqueue/pause on shutdown; recreate container; complete; verify artifact/sidecars; start local playback and wait for `playback-started`; shut down and assert no temp/child residue. Never print fixture URLs.

- [ ] **Step 5: Run deterministic test and commit**

```bash
bun run --cwd apps/cli test:file -- test/unit/live/offline-beta-smoke-report.test.ts
git add apps/cli/test/live/offline-beta.smoke.ts \
  apps/cli/test/live/offline-beta-smoke-report.ts \
  apps/cli/test/unit/live/offline-beta-smoke-report.test.ts \
  apps/cli/package.json package.json
git commit -m "test(offline): add opt-in beta release-candidate smoke"
```

## Slice Verification

```bash
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
bun run pkg:check
```

Then, with maintainer-controlled short media/subtitle fixtures:

```bash
KUNAI_OFFLINE_BETA_SMOKE=1 \
KUNAI_OFFLINE_SMOKE_MEDIA_URL="$KUNAI_RELEASE_SMOKE_MEDIA_URL" \
KUNAI_OFFLINE_SMOKE_SUBTITLE_URL="$KUNAI_RELEASE_SMOKE_SUBTITLE_URL" \
  bun run test:live:offline-beta
```

Expected: all required offline beta checks pass; no URLs appear in the report.
