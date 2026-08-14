# Retained PR Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement the useful reliability patterns from stale PRs #6, #7, #8, #10, #13, and #15 against current `main` without importing the old stacked branches.

**Architecture:** Wait until the active notification/startup WIP is settled, then create one normal local branch from the exact current `main` tip. Deliver six narrow commits in dependency order: CI bootstrap, overlay lifecycle, shell input ownership, diagnostics trust, cache identity, and evidence-backed distribution hardening.

**Tech Stack:** Bun 1.3.x, TypeScript, React/Ink, Bun test, SQLite storage repositories, GitHub Actions, Bash, PowerShell.

## Global Constraints

- Do not use a worktree.
- Do not rebase, merge, or cherry-pick the stale PR branches.
- Keep every unrelated notification/startup/package/docs WIP hunk out of these commits.
- Use explicit path staging; never use `git add -A` or `git add .`.
- Episode numbers remain 1-based in user-facing and app-service inputs.
- Keep app-shell/container dependencies out of diagnostics services.
- Keep SQL in `packages/storage`; no source-inventory SQL migration is allowed.
- No live provider, Discord, YouTube, or relay call may enter the default test path.
- Run commands with `bun`, `bunx`, or `bun run`.
- Do not close retained PRs #6, #7, #8, or #13 until all replacements are verified and the user explicitly approves those exact closures.

---

## File Structure

### Slice 1 — CI bootstrap — ✅ LANDED 2026-07-19 (do not reimplement)

Delivered on `main` ahead of this plan because it blocked the 0.3.0 release:
`scripts/ci-bootstrap-contract.ts`, its unit test, checkout removed from the
composite, checkout added to all 12 local-composite call sites across
`ci.yml` / `release.yml` / `build-binaries.yml`, and the caller-owned-checkout
section in `.docs/repo-infrastructure.md`.

**Remaining for this track:** none in code. The one open item is _verification_
— a real `workflow_dispatch` run of `release.yml` must reach the publish step.
A green contract test is not evidence the pipeline works. Start at Slice 2.

<details>
<summary>Original Slice 1 scope (for reference)</summary>

- Create `scripts/ci-bootstrap-contract.ts`: parse workflow YAML and report local-composite checkout-order violations.
- Create `apps/cli/test/unit/scripts/ci-bootstrap-contract.test.ts`: lock the checked-in workflow contract.
- Modify `.github/actions/setup-bun-monorepo/action.yml`: remove checkout; keep Bun/cache/install only.
- Modify `.github/workflows/ci.yml`: add checkout before every local-composite use.
- Modify `.github/workflows/release.yml`: add checkout before both local-composite uses.
- Modify `.github/workflows/build-binaries.yml`: add checkout before `all-targets` uses the local composite.
- Modify `.docs/repo-infrastructure.md`: document caller-owned checkout.

</details>

### Slice 2 — Overlay lifecycle

- Create `apps/cli/src/app-shell/RootContentSuspension.tsx`: shell-local suspension context.
- Create `apps/cli/test/unit/app-shell/root-content-retention.useinput.test.tsx`: mounted-state and hidden-input proof.
- Modify `apps/cli/src/app-shell/root-content-state.ts`: add retainability policy and `overlay-over-mounted` state.
- Modify `apps/cli/src/app-shell/root-content-shell.tsx`: stable retained-content composition.
- Modify `apps/cli/src/app-shell/shell-frame.tsx`: suspend all hidden frame input paths.
- Modify `apps/cli/src/app-shell/browse-shell.tsx`: suspend direct browse input and calendar work.
- Modify `apps/cli/src/app-shell/hooks/use-calendar-now.ts`: pause/resume interval on the same mount.
- Modify `apps/cli/test/unit/app-shell/root-content-state.test.tsx`.
- Modify `apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx`.
- Modify `apps/cli/test/unit/app-shell/use-calendar-now.test.tsx`.

### Slice 3 — Shell input ownership

- Modify `apps/cli/src/app-shell/shell-frame.tsx`: suppress fallback delivery for enabled footer-owned letters.
- Modify `apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx`: exact no-double-delivery and post-play regression proof.

### Slice 4 — Diagnostics trust — ➡️ MOVED to Track C (do not implement here)

Reassigned 2026-07-19 to
`docs/superpowers/plans/2026-07-19-observability-and-optin-telemetry.md`.
It edits the same diagnostics services as that track (`DiagnosticsBundleBuilder`,
the diagnostics overlay, `root-overlay-shell`), and two agents editing one
subject area is what forced an awkward staggered schedule. One owner per
subject. Skip this slice entirely and go from Slice 3 to Slice 5.

<details>
<summary>Original Slice 4 scope (now owned by Track C)</summary>

- Modify `packages/storage/test/diagnostics-repository.test.ts`: prove current-session reads.
- Modify `apps/cli/src/services/diagnostics/DurableDiagnosticsSink.ts`: expose session reads and failure state.
- Modify `apps/cli/src/services/diagnostics/DiagnosticsService.ts`: extend support-bundle input contract.
- Modify `apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts`: merge memory/current-session durable evidence.
- Modify `apps/cli/src/services/diagnostics/DiagnosticsBundleBuilder.ts`: forward panel-equivalent evidence.
- Modify `apps/cli/src/container/bootstrap-persistence.ts`: pass session ID and bounded sink warning callback.
- Create `apps/cli/src/app-shell/diagnostics-bundle-input.ts`: container-to-service adapter.
- Modify `apps/cli/src/app-shell/root-overlay-bridge.ts`: one async diagnostics preparation/open path.
- Modify `apps/cli/src/app-shell/root-overlay-shell.tsx`: render prepared YouTube evidence.
- Modify `apps/cli/src/app-shell/dispatch-palette-command.ts`: use the unified opener.
- Modify `apps/cli/src/app-shell/workflows/shell-workflows.ts`: use unified diagnostics and shared bundle input.
- Add focused diagnostics read-policy, bundle-input, preparation, and routing tests under `apps/cli/test/unit/`.

</details>

### Slice 5 — Source-inventory quality partition

- Modify `apps/cli/src/services/playback/SourceInventoryService.ts`: add quality identity and schema `v5`.
- Modify `apps/cli/src/services/playback/PlaybackResolveService.ts`: forward quality to inventory get/set/delete.
- Modify `apps/cli/src/app/playback/playback-source-cache-invalidation.ts`: build quality-aware invalidation identity.
- Modify `apps/cli/src/services/playback/schedule-videasy-lazy-probes.ts`: include quality in lazy inventory keys.
- Modify `apps/cli/src/services/playback/VideasyLazySourceProbeService.ts`: use canonical hashed identity for in-flight dedupe.
- Modify/add focused source-inventory, resolve, invalidation, Tracks, scheduler, and lazy-probe tests.
- Modify `.docs/playback-source-inventory-contract.md` and `.docs/diagnostics-guide.md`.

### Slice 6 — Distribution audit and hardening

- Modify `apps/cli/test/integration/install-scripts.test.ts` and `install-scripts-pwsh.test.ts` first.
- Create or extend a shared local installer fixture helper under `apps/cli/test/integration/helpers/` only if duplication requires it.
- Modify `install.sh` and `install.ps1` only for test-confirmed current gaps.
- Create `scripts/release-asset-contract.ts` and `scripts/verify-github-release-assets.ts`.
- Create `apps/cli/test/unit/scripts/distribution-contract.test.ts`.
- Modify `.github/workflows/release.yml` and `.github/workflows/build-binaries.yml` for verified asset/smoke gaps.
- Update user and maintainer distribution documentation only when behavior changes.

---

### Task 0: Create the Implementation Branch (WIP settled 2026-07-19)

**Files:** No product files.

**Interfaces:**

- Consumes: exact current `main` after notification/startup WIP is committed or otherwise settled.
- Produces: local branch `fix/retained-pr-reliability-train` with no unrelated uncommitted changes.

- [ ] **Step 1: Inspect the working tree without changing it**

Run:

```sh
git status --short --branch
git diff --name-only
git diff --cached --name-only
```

Expected: clean. As of 2026-07-19 all notification/startup/provider WIP is committed to `main`, the TypeScript 7 toolchain bump is committed, and only a personal `scripts/bin.sh` helper remains untracked. Branch from the current `main` tip — several files this plan touches (PlaybackResolveService, PlaybackPhase, ink-shell) were rewritten that day. The design and plan files may remain uncommitted only if the user explicitly wants them carried onto the implementation branch.

- [ ] **Step 2: Stop if unrelated WIP remains**

If any active product WIP remains, do not stash, reset, commit, or switch branches. Report the exact paths and wait for the owner to settle them.

- [ ] **Step 3: Create the normal local branch**

Run only after Step 1 is clear:

```sh
git switch -c fix/retained-pr-reliability-train
```

Expected: branch changes from `main` to `fix/retained-pr-reliability-train`; no file content changes.

- [ ] **Step 4: Record the baseline**

Run:

```sh
git rev-parse --short=12 HEAD
git status --short --branch
```

Expected: the recorded HEAD is the settled current-main tip and the working tree contains only explicitly approved plan/spec files, or is clean.

---

### Task 1: Enforce Checkout Before Local Composite Actions

**Files:**

- Create: `scripts/ci-bootstrap-contract.ts`
- Create: `apps/cli/test/unit/scripts/ci-bootstrap-contract.test.ts`
- Modify: `.github/actions/setup-bun-monorepo/action.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/build-binaries.yml`
- Modify: `.docs/repo-infrastructure.md`

**Interfaces:**

- Produces: `findLocalCompositeCheckoutViolations(workflow: unknown): readonly string[]`.
- Contract: each `uses: ./.github/actions/setup-bun-monorepo` step has an earlier `uses: actions/checkout@...` step in the same job.

- [ ] **Step 1: Write the failing contract test**

Create `apps/cli/test/unit/scripts/ci-bootstrap-contract.test.ts`:

```ts
import { expect, test } from "bun:test";
import { join } from "node:path";

import {
  findLocalCompositeCheckoutViolations,
  localCompositeContainsCheckout,
} from "../../../../../scripts/ci-bootstrap-contract";

const ROOT = join(import.meta.dirname, "../../../../..");
const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/workflows/build-binaries.yml",
  ".github/workflows/provider-matrix.yml",
] as const;

test("local Bun composite never owns checkout", async () => {
  const action = await Bun.file(join(ROOT, ".github/actions/setup-bun-monorepo/action.yml")).text();

  expect(localCompositeContainsCheckout(action)).toBe(false);
});

test("every local-composite caller checks out first", async () => {
  const violations: string[] = [];

  for (const relativePath of workflows) {
    const workflow = Bun.YAML.parse(await Bun.file(join(ROOT, relativePath)).text());
    violations.push(
      ...findLocalCompositeCheckoutViolations(workflow).map(
        (violation) => `${relativePath}:${violation}`,
      ),
    );
  }

  expect(violations).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/scripts/ci-bootstrap-contract.test.ts
```

Expected: FAIL because `scripts/ci-bootstrap-contract.ts` does not exist.

- [ ] **Step 3: Implement the pure contract helper**

Create `scripts/ci-bootstrap-contract.ts`:

```ts
const LOCAL_SETUP_ACTION = "./.github/actions/setup-bun-monorepo";

export function localCompositeContainsCheckout(source: string): boolean {
  return /uses:\s*actions\/checkout@/u.test(source);
}

export function findLocalCompositeCheckoutViolations(workflow: unknown): readonly string[] {
  const jobs = readRecord(readRecord(workflow).jobs);
  const violations: string[] = [];

  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const steps = Array.isArray(readRecord(rawJob).steps)
      ? (readRecord(rawJob).steps as unknown[])
      : [];
    let checkoutSeen = false;

    for (const rawStep of steps) {
      const step = readRecord(rawStep);
      const uses = typeof step.uses === "string" ? step.uses : "";

      if (uses.startsWith("actions/checkout@")) {
        checkoutSeen = true;
      }

      if (uses === LOCAL_SETUP_ACTION && !checkoutSeen) {
        violations.push(`${jobName} uses local setup before checkout`);
      }
    }
  }

  return violations;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
```

- [ ] **Step 4: Re-run and verify the intended current failures**

Run the Step 2 command again.

Expected: FAIL listing checkout inside the composite and jobs such as `fmt`, `lint`, `typecheck`, `test`, `windows-cli`, `build-cli`, `checks-docs`, `build-binaries`, release jobs, and `all-targets`.

- [ ] **Step 5: Move checkout ownership to callers**

In `.github/actions/setup-bun-monorepo/action.yml`, delete only the checkout step. Update the description to:

```yaml
description: Bun, dependency caches, and install for Kunai workspace jobs.
```

Before every local-composite use in `ci.yml`, `release.yml`, and `build-binaries.yml`, add:

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
    filter: blob:none
```

Do not duplicate checkout in `provider-matrix.yml`; it is already correct.

- [ ] **Step 6: Document the infrastructure contract**

Add to `.docs/repo-infrastructure.md`:

```md
### Local composite checkout rule

GitHub must load local actions from the checked-out workspace. Every job that
uses `./.github/actions/setup-bun-monorepo` must run `actions/checkout` first.
The composite owns Bun setup, caches, and frozen dependency installation; it
must never attempt to bootstrap its own checkout.
```

- [ ] **Step 7: Run focused verification**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/scripts/ci-bootstrap-contract.test.ts
```

Expected: PASS with zero violations.

- [ ] **Step 8: Run static repository gates**

Run:

```sh
bun run typecheck
bun run lint
bun run fmt:check
```

Expected: all exit `0`.

- [ ] **Step 9: Stage only Slice 1 and commit**

Run:

```sh
git add \
  scripts/ci-bootstrap-contract.ts \
  apps/cli/test/unit/scripts/ci-bootstrap-contract.test.ts \
  .github/actions/setup-bun-monorepo/action.yml \
  .github/workflows/ci.yml \
  .github/workflows/release.yml \
  .github/workflows/build-binaries.yml \
  .docs/repo-infrastructure.md

git diff --cached --name-only
git commit -m "fix(ci): require checkout before local composite actions"
```

Expected: exactly the seven paths above are committed.

---

### Task 2: Preserve Browse and Post-Play State Beneath Root Overlays

**Files:**

- Create: `apps/cli/src/app-shell/RootContentSuspension.tsx`
- Create: `apps/cli/test/unit/app-shell/root-content-retention.useinput.test.tsx`
- Modify: `apps/cli/src/app-shell/root-content-state.ts`
- Modify: `apps/cli/src/app-shell/root-content-shell.tsx`
- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx`
- Modify: `apps/cli/src/app-shell/hooks/use-calendar-now.ts`
- Modify: `apps/cli/test/unit/app-shell/root-content-state.test.tsx`
- Modify: `apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx`
- Modify: `apps/cli/test/unit/app-shell/use-calendar-now.test.tsx`

**Interfaces:**

- Produces: `RootContentSuspension`, `useRootContentSuspended()`.
- Produces: `ResolvedRootContent` variant `{ kind: "overlay-over-mounted"; session: RootContentSession }`.
- `useCalendarNow(enabled: boolean, suspended?: boolean): number`.

- [ ] **Step 1: Write state-selector tests**

Extend `root-content-state.test.tsx` with browse/post-play retention and picker/loading exclusion:

```tsx
const browseSession = {
  id: 41,
  kind: "browse",
  element: <Text>browse</Text>,
} as const;

expect(resolvedRootContentFromSurface("root-overlay", browseSession)).toEqual({
  kind: "overlay-over-mounted",
  session: browseSession,
});

expect(
  resolvedRootContentFromSurface("root-overlay", {
    ...browseSession,
    kind: "post-playback",
  }),
).toMatchObject({ kind: "overlay-over-mounted" });

for (const kind of ["picker", "loading"] as const) {
  expect(
    resolvedRootContentFromSurface("root-overlay", {
      ...browseSession,
      kind,
    }),
  ).toEqual({ kind: "overlay" });
}
```

- [ ] **Step 2: Write failing retention/input tests**

Create `root-content-retention.useinput.test.tsx` with a stateful retained probe that:

1. increments selection from `0` to `1`;
2. switches to overlay-covered state;
3. receives another `j` while hidden;
4. switches back;
5. asserts selection is still `1` and mount count remained `1`.

Also render a real `BrowseShell` under suspension, type `Dune`, suspend it, type `ZZZ`, resume it, and assert `DuneZZZ` never appears.

- [ ] **Step 3: Write failing ShellFrame suspension coverage**

Add to `shell-frame-input-bridge.test.tsx`:

```tsx
test("retained-content suspension drops frame input", () => {
  const resolved: ShellAction[] = [];
  const unhandled: string[] = [];
  const handle = render(
    <RootContentSuspension suspended>
      <Frame
        onResolve={(action) => resolved.push(action)}
        onUnhandledInput={(input) => unhandled.push(input)}
      />
    </RootContentSuspension>,
  );

  for (const input of ["g", "?", "x", "/"]) {
    handle.stdin.enqueue(input);
  }

  expect(resolved).toEqual([]);
  expect(unhandled).toEqual([]);
  handle.unmount();
});
```

- [ ] **Step 4: Write failing timer pause/resume coverage**

Update `use-calendar-now.test.tsx` to call `useCalendarNow(enabled, suspended)` and prove:

- no interval when calendar is disabled;
- one 60-second interval when enabled and visible;
- zero intervals after suspension on the same mount;
- one interval after resume;
- zero intervals after unmount.

- [ ] **Step 5: Run the new tests and verify RED**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app-shell/root-content-state.test.tsx \
  test/unit/app-shell/root-content-retention.useinput.test.tsx \
  test/unit/app-shell/shell-frame-input-bridge.test.tsx \
  test/unit/app-shell/use-calendar-now.test.tsx
```

Expected: FAIL because the suspension module and retained state do not exist; the current timer ignores suspension.

- [ ] **Step 6: Implement the suspension context**

Create `RootContentSuspension.tsx`:

```tsx
import React, { createContext, useContext } from "react";

const RootContentSuspendedContext = createContext(false);

export function RootContentSuspension({
  suspended,
  children,
}: {
  readonly suspended: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <RootContentSuspendedContext.Provider value={suspended}>
      {children}
    </RootContentSuspendedContext.Provider>
  );
}

export function useRootContentSuspended(): boolean {
  return useContext(RootContentSuspendedContext);
}
```

- [ ] **Step 7: Add the retained root-content state**

In `root-content-state.ts`, add:

```ts
export function isRetainableRootContentKind(kind: RootContentKind): boolean {
  return kind === "browse" || kind === "post-playback";
}
```

Extend `ResolvedRootContent` with `overlay-over-mounted`. In the `root-overlay` branch, return that state only when `rootContent` exists and its kind is retainable; otherwise return plain `overlay`.

- [ ] **Step 8: Keep the same mounted component identity**

In `root-content-shell.tsx`, add `RetainedRootContentLayer` that always renders the mounted session in the same first-child position and toggles only `display` and suspension context. Use the same component for both `mounted` and `overlay-over-mounted`; render `RootOverlayLoader` as a sibling outside the suspended provider.

- [ ] **Step 9: Gate ShellFrame input**

In `shell-frame.tsx`:

```ts
const rootContentSuspended = useRootContentSuspended();
const inputDisabled = inputLocked || rootContentSuspended;
```

- Return early from the hard-global handler when suspended.
- Pass `inputDisabled` to `useShellInput`.
- Return early from help/fallback input when `inputDisabled`.
- Keep overlay input outside this provider.

- [ ] **Step 10: Gate browse input and calendar work**

In `browse-shell.tsx`, read `useRootContentSuspended()`, return before browse-local key tracing/handling, and call:

```ts
const calendarNow = useCalendarNow(isCalendarView, rootContentSuspended);
```

Do not change notification code in `root-overlay-shell.tsx`.

- [ ] **Step 11: Update the timer implementation**

Use:

```ts
export function useCalendarNow(enabled: boolean, suspended = false): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || suspended) return;
    const id = setInterval(() => setNow(Date.now()), CALENDAR_NOW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, suspended]);

  return now;
}
```

- [ ] **Step 12: Run the complete focused shell suite**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app-shell/root-content-state.test.ts \
  test/unit/app-shell/root-content-state.test.tsx \
  test/unit/app-shell/root-content-retention.useinput.test.tsx \
  test/unit/app-shell/shell-frame-input-bridge.test.tsx \
  test/unit/app-shell/use-calendar-now.test.tsx \
  test/unit/app-shell/browse-first-paint.useinput.test.tsx \
  test/unit/app-shell/calendar-navigation.useinput.test.tsx \
  test/unit/app-shell/root-overlay-loader.test.tsx \
  test/unit/architecture/dev-entrypoint.test.ts
```

Expected: all pass.

- [ ] **Step 13: Run CLI typecheck and commit**

Run:

```sh
bun run --cwd apps/cli typecheck

git add \
  apps/cli/src/app-shell/RootContentSuspension.tsx \
  apps/cli/src/app-shell/root-content-state.ts \
  apps/cli/src/app-shell/root-content-shell.tsx \
  apps/cli/src/app-shell/shell-frame.tsx \
  apps/cli/src/app-shell/browse-shell.tsx \
  apps/cli/src/app-shell/hooks/use-calendar-now.ts \
  apps/cli/test/unit/app-shell/root-content-state.test.tsx \
  apps/cli/test/unit/app-shell/root-content-retention.useinput.test.tsx \
  apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx \
  apps/cli/test/unit/app-shell/use-calendar-now.test.tsx

git commit -m "fix(shell): preserve mounted state under root overlays"
```

Expected: typecheck passes and only Slice 2 paths are committed.

---

### Task 3: Prevent Footer Letters from Reaching Two Input Owners

**Files:**

- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
- Modify: `apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx`

**Interfaces:**

- Consumes Slice 2 `inputDisabled` behavior.
- Produces internal `isEnabledFooterOwnedLetter(input, footerActions): boolean`.

- [ ] **Step 1: Strengthen the existing bridge test**

Change the footer/unbound assertion to:

```tsx
handle.stdin.enqueue("g");
handle.stdin.enqueue("x");

expect(resolved).toEqual(["help"]);
expect(unhandled).toEqual(["x"]);
```

- [ ] **Step 2: Add post-play single-dispatch coverage**

Use the real post-play footer builder and fallback resolver. Enqueue `o`, `r`, `n`, and `m`; assert the resulting shell actions are exactly `source`, `replay`, `next`, and `menu`, once each.

Add explicit tests that disabled footer letters still reach fallback and `letterKeysHandledExternally` still forwards letters without footer resolution.

- [ ] **Step 3: Run the test and verify RED**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/shell-frame-input-bridge.test.tsx
```

Expected: FAIL because the bound footer letter also appears in `unhandled` and post-play actions are duplicated.

- [ ] **Step 4: Implement shared ownership in ShellFrame**

Add:

```ts
function isEnabledFooterOwnedLetter(
  input: string,
  footerActions: readonly FooterAction[],
): boolean {
  if (!/^[a-z]$/iu.test(input)) return false;
  const normalized = input.toLowerCase();
  return footerActions.some(
    (action) =>
      action.key === normalized && action.disabled !== true && action.action !== undefined,
  );
}
```

Before `onUnhandledInput`, return when:

```ts
!letterKeysHandledExternally && isEnabledFooterOwnedLetter(input, footerActions);
```

Keep `inputDisabled`, command mode, `?`, arrows, Enter, digits, and external-letter behavior unchanged.

- [ ] **Step 5: Run focused ownership tests**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app-shell/shell-frame-input-bridge.test.tsx \
  test/unit/app-shell/shell-command-input.useinput.test.tsx \
  test/unit/app-shell/post-play-h.useinput.test.tsx \
  test/unit/app-shell/post-play-footer-actions.test.ts \
  test/unit/app-shell/playback-shell-input.test.ts \
  test/unit/app-shell/tracks-panel-input-bridge.test.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit Slice 3**

Run:

```sh
git add \
  apps/cli/src/app-shell/shell-frame.tsx \
  apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx

git commit -m "fix(shell): prevent footer key double dispatch"
```

Expected: one independent two-file commit.

---

### Task 4: Merge Live Diagnostics Evidence and Unify Panel/Export Paths

**Files:**

- Modify: `packages/storage/test/diagnostics-repository.test.ts`
- Modify: `apps/cli/src/services/diagnostics/DurableDiagnosticsSink.ts`
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsService.ts`
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts`
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsBundleBuilder.ts`
- Modify: `apps/cli/src/container/bootstrap-persistence.ts`
- Create: `apps/cli/src/app-shell/diagnostics-bundle-input.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-bridge.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/dispatch-palette-command.ts`
- Modify: `apps/cli/src/app-shell/workflows/shell-workflows.ts`
- Add focused tests named below.

**Interfaces:**

- `DurableDiagnosticsSink.listBySession(sessionId, limit?)`.
- `DurableDiagnosticsSink.isFailed(): boolean`.
- `DiagnosticsServiceDeps.sessionId: string`.
- `buildSupportBundleInputFromContainer(container, panelInput?)`.
- `openDiagnosticsOverlay(container, source, loader?)`.

- [ ] **Step 1: Write storage and service read-policy tests**

In `packages/storage/test/diagnostics-repository.test.ts`, insert events for `session-live` and `session-old`, then assert:

```ts
expect(repository.listBySession("session-live", 10).map((event) => event.sessionId)).toEqual([
  "session-live",
  "session-live",
]);
```

Create `apps/cli/test/unit/services/diagnostics/diagnostics-read-policy.test.ts` with a memory event and a stale durable event:

```ts
const recent = serviceWith({
  sessionId: "session-live",
  memory: [event({ message: "memory-live", sessionId: "session-live", timestamp: 20 })],
  durableBySession: [event({ message: "durable-live", sessionId: "session-live", timestamp: 10 })],
  durableGlobal: [event({ message: "stale-old", sessionId: "session-old", timestamp: 30 })],
}).getRecent(10);

expect(recent.map((event) => event.message)).toEqual(["memory-live", "durable-live"]);
```

Define the fixture locally in the same test file:

```ts
function serviceWith(input: {
  readonly sessionId: string;
  readonly memory: readonly DiagnosticEvent[];
  readonly durableBySession: readonly DiagnosticEvent[];
  readonly durableGlobal: readonly DiagnosticEvent[];
}): DiagnosticsServiceImpl {
  return new DiagnosticsServiceImpl({
    sessionId: input.sessionId,
    logger: silentLogger,
    store: {
      record: () => {},
      getRecent: (limit) => input.memory.slice(0, limit ?? Number.POSITIVE_INFINITY),
      getSnapshot: () => [...input.memory].reverse(),
      clear: () => {},
    },
    durableSink: {
      enqueue: () => {},
      getRecent: (limit) => input.durableGlobal.slice(0, limit ?? Number.POSITIVE_INFINITY),
      getSnapshot: (limit) => input.durableGlobal.slice(0, limit ?? Number.POSITIVE_INFINITY),
      listBySession: (_sessionId, limit) =>
        input.durableBySession.slice(0, limit ?? Number.POSITIVE_INFINITY),
      isFailed: () => false,
      flush: () => {},
      clear: () => {},
    },
  });
}
```

Use the test suite's existing no-op logger fixture as `silentLogger`. Add separate assertions that exact duplicates collapse once, context-distinct events remain distinct, `getRecent(1)` enforces the limit, `getSnapshot()` is oldest-first, and failed/throwing durable sinks return memory.

- [ ] **Step 2: Write durable-sink failure tests**

Extend `DurableDiagnosticsSink.test.ts` with an insert failure:

```ts
const failures: DurableDiagnosticsFailure[] = [];
const sink = new AsyncDurableDiagnosticsSink({
  repository: {
    insert: () => {
      throw new Error(`disk full ${"x".repeat(500)}`);
    },
    listRecent: () => [],
    listBySession: () => [],
    getSnapshot: () => [],
    prune: () => ({ deleted: 0 }),
    clear: () => {},
  } as unknown as DiagnosticEventsRepository,
  onFailure: (failure) => failures.push(failure),
});

sink.enqueue(event({ message: "write" }));
sink.flush();

expect(sink.isFailed()).toBe(true);
expect(sink.listBySession("session-live", 10)).toEqual([]);
expect(failures).toHaveLength(1);
expect(failures[0]?.message.length).toBeLessThanOrEqual(240);
```

Add equivalent prune/read failures and assert later enqueue calls remain no-ops.

- [ ] **Step 3: Run trust tests and verify RED**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/services/diagnostics/diagnostics-read-policy.test.ts \
  test/unit/services/diagnostics/diagnostics-service.test.ts \
  test/unit/services/diagnostics/DurableDiagnosticsSink.test.ts
```

Expected: FAIL because session reads, failed-state exposure, and merge policy do not exist.

- [ ] **Step 4: Implement sink and service contracts**

In `DurableDiagnosticsSink.ts`, expose `listBySession`, `isFailed`, and a bounded `onFailure` callback. Flush before reads; on repository failure, mark failed and return `[]`.

In `DiagnosticsServiceImpl.ts`:

```ts
getRecent(limit?: number): readonly DiagnosticEvent[] {
  return this.mergeRecentEvents(limit);
}

getSnapshot(): readonly DiagnosticEvent[] {
  return [...this.mergeRecentEvents(500)].reverse();
}
```

`mergeRecentEvents` must prefer current-session durable rows, merge memory, deduplicate by complete event identity, sort newest-first, and cap the result. If the sink is absent or failed, return memory.

Pass `sessionId` and the sink warning callback from `bootstrap-persistence.ts`.

- [ ] **Step 5: Re-run trust tests and verify GREEN**

Run the Step 3 command.

Expected: all pass with no stale-session masking.

- [ ] **Step 6: Write panel/export parity tests**

Create `apps/cli/test/unit/app-shell/diagnostics-bundle-input.test.ts`. Build one `panelInput`, derive `bundleInput`, and assert the same snapshot is reused:

```ts
const panelInput = buildDiagnosticsPanelInput(container);
const bundleInput = buildSupportBundleInputFromContainer(container, panelInput);
const panelLines = buildDiagnosticsPanelLines(panelInput);
const bundle = diagnosticsService.buildSupportBundle(bundleInput);

expect(bundleInput.sessionState).toBe(panelInput.state);
expect(bundleInput.downloadSummary).toBe(panelInput.downloadSummary);
expect(bundleInput.releaseSummary).toBe(panelInput.releaseSummary);
expect(bundleInput.releaseDiagnostics).toBe(panelInput.releaseDiagnostics);
expect(bundleInput.presenceSnapshot).toBe(panelInput.presenceSnapshot);
expect(bundleInput.memorySamples).toBe(panelInput.memorySamples);
expect(bundleInput.getProviderHealth).toBe(panelInput.getProviderHealth);

expect(panelLines.find((line) => line.label === "Downloads")?.tone).toBe("warning");
expect(panelLines.find((line) => line.label === "Discord")?.tone).toBe("warning");
expect(bundle.triage.affectedSubsystems).toEqual(
  expect.arrayContaining(["downloads", "discord", "release-sync"]),
);
expect(JSON.stringify(bundle)).not.toContain("getProviderHealth");
```

Use fixture summaries with one failed download, unavailable Discord presence, and stale/error release reconciliation so each assertion is deterministic.

- [ ] **Step 7: Implement the shared bundle input**

Create `diagnostics-bundle-input.ts` that calls `buildDiagnosticsPanelInput(container)` and adds current playback source inventory. Extend `DiagnosticsService`/`DiagnosticsBundleBuilder` inputs and forward the fields to existing `buildDiagnosticsInsight` policy. Do not change `diagnostics-insight.ts`.

- [ ] **Step 8: Write unified opener/routing tests**

Create:

- `apps/cli/test/unit/app-shell/diagnostics-overlay-preparation.test.ts`;
- `apps/cli/test/unit/app-shell/diagnostics-workflow-routing.test.ts`.

Use an injected preparation loader so no real probe runs:

```ts
const calls: string[] = [];
await openDiagnosticsOverlay(container, "diagnostics-palette", async () => ({
  recordMemorySample: (_container, source) => calls.push(`memory:${source}`),
  runYoutubeProbes: async () => {
    calls.push("youtube");
  },
}));

expect(calls).toEqual(["memory:diagnostics-palette", "youtube"]);
expect(stateManager.getState().activeModals.at(-1)).toEqual({
  type: "diagnostics",
});
```

Before resolving a deferred `runYoutubeProbes`, assert no overlay exists. After resolving it, assert the overlay opens and `extractYoutubeProbeFromEvents(container.diagnosticsService.getRecent())` reconstructs the fresh probe evidence. Prove palette and workflow both call the same opener with their exact source labels.

- [ ] **Step 9: Implement one diagnostics opener**

In `root-overlay-bridge.ts`, add:

```ts
export type DiagnosticsOverlayPreparation = {
  readonly recordMemorySample: (container: Container, source: string) => void;
  readonly runYoutubeProbes: (container: Container) => Promise<void>;
};

export async function openDiagnosticsOverlay(
  container: Container,
  source: string,
  load: () => Promise<DiagnosticsOverlayPreparation> = loadDiagnosticsOverlayPreparation,
): Promise<void> {
  const preparation = await load();
  preparation.recordMemorySample(container, source);
  await preparation.runYoutubeProbes(container);
  await openRootOwnedOverlay(container, { type: "diagnostics" });
}
```

The default loader dynamically imports `recordDiagnosticsPanelMemorySample` and `runYoutubeDiagnosticsProbes`; wrap the latter so its returned probe is intentionally ignored after it records normal events. The existing `extractYoutubeProbeFromEvents` path remains the single renderer fallback, so no new probe payload is added to `SessionState`.

Route:

- palette source as `diagnostics-palette`;
- workflow source as `diagnostics-command`;
- command from another overlay as `diagnostics-overlay-command`.

`RootOverlayShell` does not run probes and does not need a new diagnostics payload type.

- [ ] **Step 10: Use the shared bundle builder for export/report**

Replace both duplicated bundle-input blocks in `shell-workflows.ts` with:

```ts
container.diagnosticsService.buildSupportBundle(buildSupportBundleInputFromContainer(container));
```

Keep issue copy and file-retention behavior unchanged.

- [ ] **Step 11: Run the full focused diagnostics suite**

Run:

```sh
bun run --cwd packages/storage test
bun run --cwd apps/cli test:file \
  test/unit/services/diagnostics/diagnostics-read-policy.test.ts \
  test/unit/services/diagnostics/diagnostics-service.test.ts \
  test/unit/services/diagnostics/DurableDiagnosticsSink.test.ts \
  test/unit/services/diagnostics/DiagnosticsStoreImpl.test.ts \
  test/unit/services/diagnostics/support-bundle.test.ts \
  test/unit/services/diagnostics/redaction.test.ts \
  test/unit/services/diagnostics/diagnostics-export.test.ts \
  test/unit/app-shell/diagnostics-bundle-input.test.ts \
  test/unit/app-shell/diagnostics-overlay-preparation.test.ts \
  test/unit/app-shell/diagnostics-workflow-routing.test.ts \
  test/unit/app-shell/dispatch-palette-command.test.ts \
  test/unit/app-shell/panel-data.test.ts \
  test/unit/app-shell/diagnostics-panel-lines.test.ts \
  test/unit/app-shell/root-overlay-bridge.test.ts
```

Expected: all pass with no live network dependency and redaction intact.

- [ ] **Step 12: Commit Slice 4**

Stage only the listed diagnostics/storage/app-shell paths and commit:

```sh
git commit -m "fix(diagnostics): unify live evidence and bundle inputs"
```

Expected: no changes in `diagnostics-insight.ts`, `IssueReportBuilder.ts`, or unrelated notification/playback/provider files.

---

### Task 5: Partition Source Inventory by Quality Preference

**Files:**

- Modify: `apps/cli/src/services/playback/SourceInventoryService.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/app/playback/playback-source-cache-invalidation.ts`
- Modify: `apps/cli/src/services/playback/schedule-videasy-lazy-probes.ts`
- Modify: `apps/cli/src/services/playback/VideasyLazySourceProbeService.ts`
- Modify/add focused tests listed below.
- Modify: `.docs/playback-source-inventory-contract.md`
- Modify: `.docs/diagnostics-guide.md`

**Interfaces:**

- `SourceInventoryCacheInput.qualityPreference?: string`.
- `SOURCE_INVENTORY_SCHEMA_VERSION = "v5"`.
- Phase-B dedupe consumes `buildSourceInventoryCacheKey(key)`.

- [ ] **Step 1: Write key-identity tests**

Update `source-inventory-service.test.ts` to assert:

```ts
const baseInput: SourceInventoryCacheInput = {
  providerId: "vidking",
  mediaKind: "series",
  titleId: "1396",
  season: 1,
  episode: 5,
};
const cacheKey = (qualityPreference?: string) =>
  buildSourceInventoryCacheKey({ ...baseInput, qualityPreference });

expect(SOURCE_INVENTORY_SCHEMA_VERSION).toBe("v5");
expect(cacheKey("auto")).not.toBe(cacheKey("720p"));
expect(cacheKey("720p")).not.toBe(cacheKey("1080p"));
```

Keep display-only metadata excluded and diagnostics limited to bounded hashes.

- [ ] **Step 2: Run the key test and verify RED**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/playback/source-inventory-service.test.ts
```

Expected: FAIL because schema is `v4` and quality is not part of identity.

- [ ] **Step 3: Implement schema-v5 quality identity**

In `SourceInventoryService.ts`:

```ts
export const SOURCE_INVENTORY_SCHEMA_VERSION = "v5";

export type SourceInventoryCacheInput = {
  // existing fields
  readonly qualityPreference?: string;
};
```

Add `normalizePart(input.qualityPreference)` between subtitle and startup priority in the preimage.

- [ ] **Step 4: Write caller-forwarding tests**

Capture resolve inventory calls:

```ts
const reads: SourceInventoryCacheInput[] = [];
const writes: SourceInventoryCacheInput[] = [];
const deletes: SourceInventoryCacheInput[] = [];

sourceInventory: {
  get: async (input) => {
    reads.push(input);
    return null;
  },
  set: async (input) => {
    writes.push(input);
  },
  delete: async (input) => {
    deletes.push(input);
  },
},

expect(reads[0]?.qualityPreference).toBe("720p");
expect(writes[0]?.qualityPreference).toBe("720p");
```

In invalidation and Tracks tests, assert the active series profile produces:

```ts
expect(inventoryInput).toEqual(expect.objectContaining({ qualityPreference: "720p" }));
```

In the lazy-probe service test, keep `1080p` work in flight while scheduling `720p`, then assert both injected probes ran:

```ts
expect(probedQualities).toContain("1080p");
expect(probedQualities).toContain("720p");
```

Use only injected fake engines/probes and local fixtures. Add the assertions to:

- `playback-resolve-service.test.ts`;
- `playback-source-cache-invalidation.test.ts`;
- `tracks-panel-data.test.ts`;
- `schedule-videasy-lazy-probes.test.ts`;
- `videasy-lazy-source-probe-service.test.ts`.

- [ ] **Step 5: Run caller tests and verify RED**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app/playback-source-cache-invalidation.test.ts \
  test/unit/app-shell/tracks-panel-data.test.ts \
  test/unit/services/playback/playback-resolve-service.test.ts \
  test/unit/services/playback/schedule-videasy-lazy-probes.test.ts \
  test/unit/services/playback/videasy-lazy-source-probe-service.test.ts
```

Expected: FAIL because current callers omit quality and phase-B dedupe suppresses different-quality work.

- [ ] **Step 6: Forward quality through current callers**

Add `qualityPreference` to the shared resolve inventory object, the shared invalidation builder, and lazy scheduling key. Replace the hand-built phase-B session key with:

```ts
function phaseBSessionKey(key: SourceInventoryCacheInput): string {
  return buildSourceInventoryCacheKey(key);
}
```

Do not modify provider-wide invalidation or the storage repository.

- [ ] **Step 7: Update the contract documentation**

Document that schema `v5` temporarily partitions inventory because cached `ProviderResolveResult.selectedStreamId` is quality-influenced. State that explicit invalidation, Tracks hints, lazy probes, and in-flight dedupe use the same identity. Diagnostics expose only key hashes.

- [ ] **Step 8: Run focused cache tests**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/services/playback/source-inventory-service.test.ts \
  test/unit/app/playback-source-cache-invalidation.test.ts \
  test/unit/app-shell/tracks-panel-data.test.ts \
  test/unit/services/playback/playback-resolve-service.test.ts \
  test/unit/services/playback/schedule-videasy-lazy-probes.test.ts \
  test/unit/services/playback/videasy-lazy-source-probe-service.test.ts
```

Expected: all pass; different-quality lazy work is not deduplicated.

- [ ] **Step 9: Run static/full/build gates required for cache work**

Run:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run build
```

Expected: all exit `0`; no live provider tests run.

- [ ] **Step 10: Commit Slice 5**

Stage only cache/playback/test/docs paths and commit:

```sh
git commit -m "fix(cache): partition source inventory by quality"
```

Expected: no storage migration and no provider adapter changes.

---

### Task 6: Audit and Harden Current Installer/Release Behavior

**Files:**

- Modify tests before product code.
- Conditional product/workflow/docs paths are limited to those named in the File Structure section.

**Interfaces:**

- Produces pure required-release-asset contract derived from `RELEASE_BINARY_TARGETS` plus `SHA256SUMS`.
- Installer dry-run must be side-effect-free.
- Missing/empty assets must fail with npm, Bun-global, source, and pinned-version recovery guidance.

- [ ] **Step 1: Add a localhost installer harness and Bash tests**

Create `apps/cli/test/integration/helpers/installer-script-harness.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createInstallerSandbox(name: string) {
  const root = mkdtempSync(join(tmpdir(), `kunai-${name}-`));
  const binDir = join(root, "bin");
  const dataDir = join(root, "data");
  const configDir = join(root, "config");
  return {
    root,
    binDir,
    dataDir,
    configDir,
    env: {
      ...process.env,
      KUNAI_BIN_DIR: binDir,
      KUNAI_DATA_DIR: dataDir,
      KUNAI_CONFIG_DIR: configDir,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export async function withReleaseFixture(
  routes: Readonly<Record<string, { readonly body: string; readonly status?: number }>>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const route = routes[new URL(request.url).pathname];
      return route
        ? new Response(route.body, { status: route.status ?? 200 })
        : new Response("not found", { status: 404 });
    },
  });
  try {
    await run(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
}
```

In `install-scripts.test.ts`, add a side-effect-free dry-run assertion:

```ts
const sandbox = createInstallerSandbox("install-sh-dry");
try {
  const result = spawnSync(
    "bash",
    [join(REPO_ROOT, "install.sh"), "--dry-run", "--yes", "--version", "9.8.7"],
    { encoding: "utf8", env: sandbox.env },
  );
  expect(result.status).toBe(0);
  expect(existsSync(sandbox.binDir)).toBe(false);
  expect(existsSync(sandbox.dataDir)).toBe(false);
  expect(existsSync(sandbox.configDir)).toBe(false);
} finally {
  sandbox.cleanup();
}
```

Use `withReleaseFixture` to add zero-byte and missing-checksum cases. Set `KUNAI_DL_BASE` to the fixture URL and assert nonzero exit, no installed binary, and exact messages containing `Downloaded asset ... is empty` or `SHA256SUMS has no entry`. Add a 404 case that requires npm, Bun, source, and pinned-version guidance; if it passes unchanged, preserve the existing copy.

- [ ] **Step 2: Run Bash installer tests and record actual failures**

Run:

```sh
bun run --cwd apps/cli test:file test/integration/install-scripts.test.ts
```

Expected current gaps: dry-run mutation, empty asset acceptance, and generic missing-checksum output. If the existing 404-copy test passes, preserve that copy unchanged.

- [ ] **Step 3: Make the smallest Bash corrections**

Compute intended paths, then return before allocation:

```bash
versions_dir="$DATA_DIR/versions"
version_path="$versions_dir/$resolved_version/kunai"

if [[ "$DRY" == 1 ]]; then
  info "[dry-run] curl -fsSL $url -o <temporary>/$asset"
  info "[dry-run] curl -fsSL $sums -o <temporary>/SHA256SUMS"
  write_manifest binary "$resolved_version" "$BIN_DIR/kunai" "$version_path" "versioned"
  path_hint "$BIN_DIR"
  return
fi

require curl
mkdir -p "$BIN_DIR"
tmp="$(mktemp -d)"
```

After download, use exact failure branches:

```bash
if [[ ! -s "$tmp/$asset" ]]; then
  err "Downloaded asset $asset is empty; the release is incomplete."
  download_failed_hint "$asset"
  exit 1
fi

want="$(awk -v a="$asset" '$2==a {print $1}' "$tmp/SHA256SUMS")"
got="$(sha256_of "$tmp/$asset")"

if [[ -z "$want" ]]; then
  err "SHA256SUMS has no entry for $asset; the release is incomplete."
  download_failed_hint "$asset"
  exit 1
fi

if [[ "$want" != "$got" ]]; then
  err "Checksum mismatch for $asset (expected $want, got $got)."
  exit 1
fi
```

- [ ] **Step 4: Re-run Bash installer tests**

Expected: PASS.

- [ ] **Step 5: Extend PowerShell installer tests**

Reuse `createInstallerSandbox` and add the equivalent dry-run, empty-asset, missing-checksum, and fallback tests. Add a fake `winget` executable to the sandbox `PATH`, then assert both dependency plans are reachable:

```ts
const sandbox = createInstallerSandbox("install-ps1-deps");
installCommandShim(sandbox.root, "winget");
try {
  const result = runInstallPs1(["-DryRun", "-Yes", "-Version", "9.8.7"], {
    ...sandbox.env,
    PATH: `${sandbox.root}${delimiter}${process.env.PATH ?? ""}`,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("winget install --id mpv.net -e");
  expect(result.stdout).toContain("winget install yt-dlp");
} finally {
  sandbox.cleanup();
}
```

Define `installCommandShim` in the shared harness:

```ts
export function installCommandShim(root: string, name: string): void {
  if (process.platform === "win32") {
    writeFileSync(join(root, `${name}.cmd`), "@echo off\r\nexit /b 0\r\n");
    return;
  }
  writeFileSync(join(root, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}
```

Add `writeFileSync` to the helper imports. Assert PowerShell dry-run creates no sandbox directories, and use the localhost release fixture for empty/missing-checksum failures.

- [ ] **Step 6: Run PowerShell tests and record actual failures**

Run:

```sh
bun run --cwd apps/cli test:file test/integration/install-scripts-pwsh.test.ts
```

Expected when `pwsh` exists: current dry-run creates directories, mpv returns before yt-dlp, and asset errors are not specific enough. If `pwsh` is unavailable, require the GitHub Windows/Ubuntu job result before completion.

- [ ] **Step 7: Make the smallest PowerShell corrections**

Resolve testable path overrides:

```powershell
$BinDir = if ($env:KUNAI_BIN_DIR) { $env:KUNAI_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'kunai\bin' }
$DataDir = if ($env:KUNAI_DATA_DIR) { $env:KUNAI_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'kunai' }
$ConfigDir = if ($env:KUNAI_CONFIG_DIR) { $env:KUNAI_CONFIG_DIR } else { Join-Path $env:APPDATA 'kunai' }
```

Create directories and download only inside `if (-not $DryRun)`. After download:

```powershell
if ((Get-Item -Path $tmp).Length -eq 0) {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  throw "Downloaded asset $asset is empty; the release is incomplete. Try -Method npm, -Method bun, or -Method source."
}

$want = ($sums -split "`n" |
  Where-Object { $_ -match "\s$([regex]::Escape($asset))$" }) -replace '\s.*', ''

if ([string]::IsNullOrEmpty($want)) {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  throw "SHA256SUMS has no entry for $asset; the release is incomplete. Try -Method npm, -Method bun, or -Method source."
}
```

Remove only the premature return after the mpv dependency branch so execution continues to the yt-dlp decision. Preserve later control flow and install methods.

- [ ] **Step 8: Create the release-asset contract and tests**

Create `scripts/release-asset-contract.ts`:

```ts
import { RELEASE_BINARY_TARGETS } from "../apps/cli/src/services/update/platform-assets";

export const REQUIRED_RELEASE_ASSET_NAMES = Object.freeze(
  [...RELEASE_BINARY_TARGETS.map((target) => target.out), "SHA256SUMS"].sort(),
);

export function assertRequiredReleaseAssets(actualNames: readonly string[]): void {
  const actual = new Set(actualNames);
  const missing = REQUIRED_RELEASE_ASSET_NAMES.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[release-assets] release is missing ${missing.length} required asset(s): ${missing.join(", ")}`,
    );
  }
}
```

Create a `gh release view` wrapper script and `distribution-contract.test.ts` that proves release upload lists all required assets, fails on unmatched files, and all-target artifacts are error-on-missing.

- [ ] **Step 9: Harden only the workflow gaps proven by tests**

In `release.yml`, add `fail_on_unmatched_files: true` and run the release-asset assertion after upload. In `build-binaries.yml`, set `if-no-files-found: error` and add host-native smoke jobs for current Linux, macOS, and Windows runners using the already-built artifact.

Do not claim native ARM execution where no matching hosted runner ran it.

- [ ] **Step 10: Run distribution-focused tests**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/integration/install-scripts.test.ts \
  test/integration/install-scripts-pwsh.test.ts \
  test/unit/scripts/distribution-contract.test.ts \
  test/unit/services/update/platform-assets.test.ts
```

Expected: Bash passes; PowerShell passes or explicitly skips locally pending GitHub proof; all requests stay on localhost.

- [ ] **Step 11: Build and smoke local release assets**

Run:

```sh
bun run build:binaries -- --only linux-x64 --only linux-x64-musl --jobs 2
bash apps/cli/scripts/verify-release-binaries.sh --partial
KUNAI_BINARY_SMOKE=1 \
  bun run --cwd apps/cli test:file test/integration/compiled-binary-smoke.test.ts
```

Expected: both binaries and `SHA256SUMS` exist; checksums, `--version`, and `--help` pass.

- [ ] **Step 12: Update distribution docs only for behavior that changed**

Update README, user install docs, quickstart, packaging, releasing, and a patch changeset when installer behavior changes. Document binary/source fallbacks and the nine-asset release-completion contract.

- [ ] **Step 13: Run repository gates**

Run:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

Expected: all exit `0`. Inspect the complete diff after formatting and exclude unrelated files.

- [ ] **Step 14: Commit Slice 6 conditionally**

If the audit required product/workflow changes, stage only confirmed paths and commit:

```sh
git commit -m "fix(distribution): harden verified installer and release gaps"
```

If every new audit test passes without product/workflow changes, do not manufacture a sixth commit; record the passing evidence in the implementation report.

---

### Task 7: End-to-End Verification, GitHub Proof, and Retained PR Disposition

**Files:** No new product files unless verification finds a test-covered defect owned by a prior slice.

**Interfaces:**

- Consumes: five or six verified slice commits.
- Produces: completion report and an explicit user decision on PRs #6, #7, #8, and #13.

- [ ] **Step 1: Verify history and scope**

Run:

```sh
git log --oneline --max-count=8
git status --short
git diff main...HEAD --name-only
git diff --check main...HEAD
```

Expected: approved slice commits only; no unrelated WIP; no whitespace errors.

- [ ] **Step 2: Run final repository gates**

Run:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run build
```

Expected: all exit `0`.

- [ ] **Step 3: Run manual shell smokes with an isolated profile**

Use fresh `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` under a temporary directory. Verify:

- browse query, selection, filters, and companion state survive Settings, Help, History, and Diagnostics;
- hidden browse ignores `j`, `k`, arrows, letters, `/`, and `?`;
- calendar minute work pauses under an overlay and resumes afterward;
- post-play selection survives overlays;
- `o`, `r`, `n`, and `m` each dispatch once;
- arrows, Enter, `j`, `k`, and recommendation digits remain single-step/single-action.

- [ ] **Step 4: Run diagnostics parity smoke outside the repository**

Launch Kunai from a temporary working directory with an isolated profile and loopback-failing YouTube metadata endpoint. Open `/diagnostics`, then `/export-diagnostics` in the same session. Verify panel and export share memory, YouTube, downloads, Discord, release, provider-health, and session evidence; verify redaction and no repository-root export.

- [ ] **Step 5: Publish only with explicit user authorization**

Do not push automatically. When authorized, push:

```sh
git push -u origin fix/retained-pr-reliability-train
```

- [ ] **Step 6: Verify the real GitHub Actions bootstrap**

After push, inspect the branch/PR CI. Confirm each local-composite job reaches checkout and then executes Bun setup rather than failing before steps load.

For distribution smoke, dispatch only when Slice 6 changed workflow behavior:

```sh
gh workflow run build-binaries.yml \
  --repo KitsuneKode/kunai \
  --ref fix/retained-pr-reliability-train
```

Expected: all-target build and Linux/macOS/Windows host-native smoke jobs pass.

- [ ] **Step 7: Request final code review**

Run the repository code-review process over `main...HEAD`. Address only verified findings in the owning slice commit; rerun focused and final gates after fixes.

- [ ] **Step 8: Present retained PR closure evidence**

Prepare a table:

- #8 replaced by CI checkout contract and successful GitHub run;
- #6 replaced by retained overlay state/input/timer proof;
- #13 replaced by single-dispatch proof;
- #7 replaced by session-scoped diagnostics merge and panel/export parity.

Include replacement commit SHAs and test/smoke results.

- [ ] **Step 9: Ask explicit permission before closing #6, #7, #8, and #13**

If approved, close those exact PRs with comments linking replacement commits. Do not delete their remote branches.

---

## Final Acceptance Checklist

- [ ] Current-main WIP was settled before branch creation.
- [ ] No worktree, stale merge, rebase, or cherry-pick was used.
- [ ] Every local composite call checks out first; the composite contains no checkout.
- [ ] Browse/post-play remain mounted under overlays and hidden input/timers are suspended.
- [ ] Footer-owned letters never reach fallback twice.
- [ ] Diagnostics merge current-session durable and memory evidence with failed-sink fallback.
- [ ] Panel, export, and report use the same subsystem snapshot.
- [ ] Palette/workflow diagnostics use one prepared overlay path with fresh YouTube evidence.
- [ ] Source-inventory schema is `v5` and quality is forwarded through every current caller.
- [ ] No storage migration or live-provider default test was added.
- [ ] Installer/release changes correspond only to failing current audit tests.
- [ ] Focused tests, typecheck, lint, formatting, full tests, and build pass.
- [ ] Manual shell and diagnostics smokes pass with isolated data.
- [ ] Real GitHub Actions bootstrap succeeds after publication.
- [ ] Retained PR closure requires a final explicit user confirmation and preserves branches.
