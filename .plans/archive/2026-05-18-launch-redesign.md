# Launch Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full UX/visual polish pass described in `.docs/launch-redesign-spec.md` across all surfaces in preparation for the public product launch.

**Architecture:** Five phases, each independently shippable. Phase 1 (Foundation) must land before any other phase since it establishes the breakpoint contract, color tokens, and footer color rules that every surface depends on. Phases 2–5 can proceed in parallel once Phase 1 is merged.

**Tech Stack:** Bun, Ink (React for terminal), TypeScript, `bun:test` for unit tests. All components live in `apps/cli/src/app-shell/`. Design tokens in `packages/design/src/tokens.ts`.

**Spec:** `.docs/launch-redesign-spec.md` — read it before touching any surface.

---

## Phase 1 — Foundation

_Unblocks everything. No user-visible surface changes until Phase 2._

### Task 1: Add `tokens.purple` to the design system

**Files:**

- Modify: `packages/design/src/tokens.ts`
- Modify: `apps/cli/src/app-shell/shell-theme.ts`

- [ ] **Step 1: Verify existing token structure**

Run: `grep -n "lavender\|purple" packages/design/src/tokens.ts`
Expected: shows `lavender` and `lavenderDim`, no purple entries.

- [ ] **Step 2: Write the failing test**

Append to `apps/cli/test/unit/app-shell/shell-theme.test.ts`:

```ts
test("palette exposes purple token for series-complete milestone color", () => {
  expect(palette.purple).toBeDefined();
  expect(palette.purple).toMatch(/^#[0-9a-f]{6}$/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test apps/cli/test/unit/app-shell/shell-theme.test.ts`
Expected: FAIL — `palette.purple is not defined`

- [ ] **Step 4: Add the token**

In `packages/design/src/tokens.ts`, after the `lavender` block:

```ts
  // Series-complete milestone — never reuse for any other purpose
  purple: "#a855f7",
  purpleDim: "#4c1d95",
```

- [ ] **Step 5: Expose in palette**

In `apps/cli/src/app-shell/shell-theme.ts`, after the `lavender` line:

```ts
  purple: tokens.purple,
  purpleDim: tokens.purpleDim,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun run test apps/cli/test/unit/app-shell/shell-theme.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add packages/design/src/tokens.ts apps/cli/src/app-shell/shell-theme.ts apps/cli/test/unit/app-shell/shell-theme.test.ts
git commit -m "feat(design): add tokens.purple for series-complete milestone color"
```

---

### Task 2: Update viewport breakpoints to match spec

The current breakpoints differ from the spec. This task brings them into alignment.

| Current                | Spec                           |
| ---------------------- | ------------------------------ |
| ultraCompact < 92 cols | blocked < 60 cols OR < 20 rows |
| compact < 110 cols     | narrow 60–79 cols              |
| mediumBrowse 110–139   | medium 80–119 cols             |
| wideBrowse 140+        | wide 120+ cols                 |

**Files:**

- Modify: `apps/cli/src/app-shell/layout-policy.ts`
- Modify: `apps/cli/test/unit/app-shell/layout-policy.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe("getShellViewportPolicy", ...)` block in `apps/cli/test/unit/app-shell/layout-policy.test.ts`:

```ts
test("narrow breakpoint: 60–79 cols, rows >= 20", () => {
  const p = getShellViewportPolicy("browse", 60, 24);
  expect(p.breakpoint).toBe("narrow");
  expect(p.tooSmall).toBe(false);
});

test("medium breakpoint: 80–119 cols", () => {
  const p = getShellViewportPolicy("browse", 80, 24);
  expect(p.breakpoint).toBe("medium");
  expect(p.wideBrowse).toBe(false);
  expect(p.mediumBrowse).toBe(false);
});

test("wide breakpoint: 120+ cols", () => {
  const p = getShellViewportPolicy("browse", 120, 24);
  expect(p.breakpoint).toBe("wide");
  expect(p.wideBrowse).toBe(true);
});

test("blocked: < 60 cols", () => {
  const p = getShellViewportPolicy("browse", 59, 24);
  expect(p.breakpoint).toBe("blocked");
  expect(p.tooSmall).toBe(true);
});

test("blocked: < 20 rows", () => {
  const p = getShellViewportPolicy("browse", 80, 19);
  expect(p.breakpoint).toBe("blocked");
  expect(p.tooSmall).toBe(true);
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `bun run test apps/cli/test/unit/app-shell/layout-policy.test.ts`
Expected: FAIL — `p.breakpoint is undefined`

- [ ] **Step 3: Update `ShellViewportPolicy` type and `getShellViewportPolicy`**

Replace the type and function in `apps/cli/src/app-shell/layout-policy.ts`:

```ts
export type ShellViewportBreakpoint = "narrow" | "medium" | "wide" | "blocked";

export type ShellViewportPolicy = {
  columns: number;
  rows: number;
  breakpoint: ShellViewportBreakpoint;
  // Derived convenience flags kept for backward compat
  compact: boolean; // true for narrow + blocked (replaces old compact logic)
  ultraCompact: boolean; // true for blocked only
  tooSmall: boolean;
  wideBrowse: boolean;
  mediumBrowse: boolean;
  minColumns: number;
  minRows: number;
  maxVisibleRows: number;
};

/** Hard minimum for blocked state — applies to all shell kinds. */
const GLOBAL_BLOCKED_MIN_COLS = 60;
const GLOBAL_BLOCKED_MIN_ROWS = 20;

/** Minimum dimensions per shell kind for tooSmall flag. */
const KIND_MINIMUMS: Record<ShellViewportKind, { minColumns: number; minRows: number }> = {
  browse: { minColumns: 60, minRows: 20 },
  picker: { minColumns: 60, minRows: 20 },
  playback: { minColumns: 60, minRows: 20 },
};

export function getShellViewportPolicy(
  kind: ShellViewportKind,
  columns: number,
  rows: number,
  options: { forceCompact?: boolean } = {},
): ShellViewportPolicy {
  const forceCompact = options.forceCompact ?? false;

  const blocked =
    forceCompact || columns < GLOBAL_BLOCKED_MIN_COLS || rows < GLOBAL_BLOCKED_MIN_ROWS;
  const narrow = !blocked && columns < 80;
  const medium = !blocked && !narrow && columns < 120;
  const wide = !blocked && !narrow && !medium;

  const breakpoint: ShellViewportBreakpoint = blocked
    ? "blocked"
    : narrow
      ? "narrow"
      : medium
        ? "medium"
        : "wide";

  // Legacy compat flags derived from new breakpoints
  const compact = blocked || narrow;
  const ultraCompact = blocked;

  // Wide browse: 120+ cols with companion pane
  const wideBrowse = !blocked && kind === "browse" && wide;
  // Medium browse: 80-119 cols with compact companion
  const mediumBrowse = !blocked && kind === "browse" && medium;

  const { minColumns, minRows } = KIND_MINIMUMS[kind];
  const tooSmall = blocked || columns < minColumns || rows < minRows;

  const maxVisibleRowsBase = blocked || narrow ? 10 : medium ? 14 : 18;

  return {
    columns,
    rows,
    breakpoint,
    compact,
    ultraCompact,
    tooSmall,
    wideBrowse,
    mediumBrowse,
    minColumns,
    minRows,
    maxVisibleRows: Math.max(5, rows - maxVisibleRowsBase),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/cli/test/unit/app-shell/layout-policy.test.ts`
Expected: all PASS (new tests + existing ones)

- [ ] **Step 5: Fix any callers that check `ultraCompact` or column thresholds directly**

Run: `grep -rn "ultraCompact\|columns < 92\|columns < 110\|columns < 132\|columns >= 140\|columns >= 110" apps/cli/src --include="*.tsx" --include="*.ts"`

For each match: update to use `policy.breakpoint === "blocked"` / `"narrow"` / `"medium"` / `"wide"` where appropriate. Keep `compact` and `ultraCompact` accesses that use the new derived flags.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app-shell/layout-policy.ts apps/cli/test/unit/app-shell/layout-policy.test.ts
git commit -m "feat(viewport): align breakpoints to spec (narrow/medium/wide/blocked)"
```

---

### Task 3: Footer primary action color — amber for primary, dim for others

Currently all footer key glyphs render in `palette.teal`. The spec requires: primary action key in amber, all others in default dim weight.

**Files:**

- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/shell-primitives.tsx`
- Modify: `apps/cli/test/unit/app-shell/shell-primitives.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/test/unit/app-shell/shell-primitives.test.ts`:

```ts
test("selectFooterActions preserves primary flag on first action", () => {
  const actions: readonly FooterAction[] = [
    { key: "enter", label: "play", action: "search", primary: true },
    { key: "/", label: "commands", action: "command-mode" },
    { key: "q", label: "quit", action: "quit" },
  ];
  const visible = selectFooterActions(actions, "detailed", 120);
  expect(visible[0].primary).toBe(true);
  expect(visible[1].primary).toBeFalsy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test apps/cli/test/unit/app-shell/shell-primitives.test.ts`
Expected: FAIL — `FooterAction` has no `primary` property

- [ ] **Step 3: Add `primary` to `FooterAction` type**

In `apps/cli/src/app-shell/types.ts`, update `FooterAction`:

```ts
export type FooterAction = {
  key: string;
  label: string;
  action: ShellAction;
  disabled?: boolean;
  reason?: string;
  /** Mark as the single primary action — renders key in amber instead of dim. */
  primary?: boolean;
};
```

- [ ] **Step 4: Update Footer render in shell-primitives.tsx**

In the `Footer` component's action map (the `visibleActions.map(...)` block), change the key color logic:

```tsx
// Replace:
<Text color={palette.teal}>{hotkeyLabel(keyDisplay)}</Text>
// With:
<Text color={action.primary ? palette.amber : palette.dim}>{hotkeyLabel(keyDisplay)}</Text>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test apps/cli/test/unit/app-shell/shell-primitives.test.ts`
Expected: PASS

- [ ] **Step 6: Mark primary actions in each caller**

Search for places that define `footerActions` arrays: `grep -rn "footerActions\|FooterAction" apps/cli/src --include="*.tsx" --include="*.ts" -l`

For each shell, mark the primary action with `primary: true`:

- `loading-shell.tsx`: no primary (non-interactive resolve screen)
- `ink-shell.tsx` browse footer: `{ key: "enter", label: "play", action: "search", primary: true }`
- Post-play shell (created in Phase 2): mark `{ key: "enter", ..., primary: true }`
- Settings footer: mark quit/done as primary

- [ ] **Step 7: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/types.ts apps/cli/src/app-shell/shell-primitives.tsx apps/cli/test/unit/app-shell/shell-primitives.test.ts
git commit -m "feat(footer): primary action key renders in amber per spec"
```

---

### Task 4: Eliminate direct `useStdout()` outside the viewport hook

`shell-frame.tsx:69`, `shell-primitives.tsx:179`, `shell-primitives.tsx:269`, `loading-shell.tsx:264` all read `stdout.columns/rows` directly. The spec says `use-viewport-policy.ts` is the sole source.

**Files:**

- Modify: `apps/cli/src/app-shell/shell-primitives.tsx`
- Modify: `apps/cli/src/app-shell/shell-frame.tsx`
- Modify: `apps/cli/src/app-shell/loading-shell.tsx`

- [ ] **Step 1: Update `Footer` component to accept `terminalWidth` as prop**

In `shell-primitives.tsx`, `Footer` currently calls `useStdout()` internally. Change it to accept the width as a prop (the parent knows the width from its viewport hook):

```tsx
export function Footer({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
  maxVisible,
  terminalWidth,  // ← add this prop
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
  maxVisible?: number;
  terminalWidth?: number;  // ← add this prop type
}) {
  // Remove: const { stdout } = useStdout();
  // Remove: const terminalWidth = stdout.columns ?? 100;
  const width = terminalWidth ?? 100;
  const taskWidth = Math.max(20, width - 4);
  const visibleActions = React.useMemo(
    () => selectFooterActions(actions, mode, mode === "detailed" ? width : undefined, maxVisible),
    [actions, mode, width, maxVisible],
  );
  // rest unchanged, use `width` instead of `terminalWidth`
```

Also update `ShellFooter` to forward the prop, and `ResizeBlocker` to accept `columns`/`rows` as props instead of calling `useStdout()`:

```tsx
export const ResizeBlocker = React.memo(function ResizeBlocker({
  columns,
  rows,
  minColumns,
  minRows,
  message = "Terminal too small",
}: {
  columns: number;
  rows: number;
  minColumns: number;
  minRows: number;
  message?: string;
}) {
  return (
    <Box marginTop={1} flexDirection="column" paddingX={1}>
      <Text color={palette.amber}>{message}</Text>
      <Text color={palette.muted}>
        {`Terminal is ${columns}×${rows}  ·  needs ${minColumns}×${minRows}`}
      </Text>
      <Text color={palette.dim}>Zoom out or resize the terminal window.</Text>
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          {APP_LABEL}
        </Text>
      </Box>
    </Box>
  );
});
```

- [ ] **Step 2: Update `ShellFrame` to not call `useStdout()` for commandWidth**

In `shell-frame.tsx`, `ShellFrame` currently calls `const { stdout } = useStdout()`. Replace with a `terminalWidth` prop passed from callers (which have viewport policy):

```tsx
export function ShellFrame({
  // ... existing props ...
  terminalWidth = 80,  // ← add
}: {
  // ... existing prop types ...
  terminalWidth?: number;  // ← add
}) {
  // Remove: const { stdout } = useStdout();
  // Remove: const commandWidth = Math.min(92, Math.max(36, Math.floor((stdout.columns ?? 80) * 0.62)));
  const commandWidth = Math.min(92, Math.max(36, Math.floor(terminalWidth * 0.62)));
  // Remove the maxVisible calculation using stdout.rows too:
  maxVisible={Math.max(5, Math.min(12, ((stdout.rows ?? 24)) - 18))}
  // → compute rows from a prop or pass maxVisible directly
```

Add `terminalRows = 24` prop similarly. Update all `ShellFrame` callers in `ink-shell.tsx` to pass these from their viewport policy hook.

- [ ] **Step 3: Update `loading-shell.tsx`**

Replace: `const { stdout } = useStdout(); const terminalColumns = stdout.columns ?? 80;`

With: call `useViewportPolicy("playback")` and use `policy.columns`.

```tsx
import { useViewportPolicy } from "./use-viewport-policy";
// inside component:
const policy = useViewportPolicy("playback");
const terminalColumns = policy.columns;
```

- [ ] **Step 4: Fix all callers passing width/rows to `ResizeBlocker`**

Search for `<ResizeBlocker` and add `columns={policy.columns} rows={policy.rows}` at each call site.

- [ ] **Step 5: Verify no remaining bare `useStdout()` for layout**

Run: `grep -rn "useStdout\|stdout\.columns\|stdout\.rows" apps/cli/src/app-shell --include="*.tsx" --include="*.ts"`

Expected: only `use-viewport-policy.ts` uses `useStdout()`. Any remaining accesses for non-layout purposes (e.g., image rendering) are acceptable.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app-shell/shell-primitives.tsx apps/cli/src/app-shell/shell-frame.tsx apps/cli/src/app-shell/loading-shell.tsx
git commit -m "refactor(viewport): centralize stdout reads in use-viewport-policy hook"
```

---

### Task 5: Staged exit sequence (5-step timed render)

Current `requestHardExit` in `graceful-exit.ts` has no UI staging. The spec adds a 200ms visual wind-down before `process.exit`.

**Files:**

- Modify: `apps/cli/src/app-shell/graceful-exit.ts`
- Create: `apps/cli/src/app-shell/exit-shell.tsx`

- [ ] **Step 1: Create the exit UI component**

Create `apps/cli/src/app-shell/exit-shell.tsx`:

```tsx
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { palette } from "./shell-theme";

type ExitStep = "dim" | "footer-gone" | "fox" | "closing" | "done";

const STEP_TIMINGS: Record<ExitStep, number> = {
  dim: 0,
  "footer-gone": 40,
  fox: 80,
  closing: 120,
  done: 200,
};

export function ExitShell({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<ExitStep>("dim");

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const steps: ExitStep[] = ["footer-gone", "fox", "closing", "done"];
    steps.forEach((s) => {
      timers.push(
        setTimeout(() => {
          setStep(s);
          if (s === "done") onDone();
        }, STEP_TIMINGS[s]),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  const isDim = step === "dim" || step === "footer-gone";

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text dimColor={isDim} color={palette.dim}>
        {step === "fox" || step === "closing" || step === "done" ? "◉  see you next time" : ""}
      </Text>
      {(step === "closing" || step === "done") && <Text color={palette.amber}>◈ kunai</Text>}
    </Box>
  );
}
```

- [ ] **Step 2: Wire exit shell into the root render**

In `apps/cli/src/app-shell/ink-shell.tsx`, when `requestHardExit` is called (via `isHardGlobalQuit`), instead of immediately exiting, render `ExitShell` with `onDone={() => process.exit(0)}`.

Find where `requestHardExit` is called from `isHardGlobalQuit` and gate it through a state transition:

```tsx
const [exiting, setExiting] = useState(false);
// replace: requestHardExit(0)
// with:
setExiting(true);
```

Render `<ExitShell onDone={() => { void runExitHandlers().finally(() => process.exit(0)); }} />` when `exiting === true`.

- [ ] **Step 3: Ctrl+C during exit skips to 40ms**

`Ctrl+C` should still work during the exit animation — it calls `requestHardExit(0)` directly which bypasses the staged exit. The existing `isHardGlobalQuit` in `shell-frame.tsx` handles this. Keep that path as-is (immediate exit).

- [ ] **Step 4: Manual test**

Run: `bun run dev -- -S "test"`
Press `q` to quit.
Expected: shell dims briefly, fox message appears, "◈ kunai" appears, terminal returns.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/exit-shell.tsx apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat(ux): staged exit sequence with fox wind-down animation"
```

---

## Phase 2 — Core Loop Polish

_Most user-visible surfaces for the launch._

### Task 6: Loading shell — 4-stage rail with spec glyphs

Current stage rail uses `◉` / `·` / `✓`. Spec wants `◐ ◓ ◑ ◒` for the 4 named stages: Resolving / Providers / Stream / Player.

Current `LoadingShellStage` type has 3 values. Add a 4th to match the spec's 4-stage model.

**Files:**

- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/loading-shell-runtime.ts`
- Modify: `apps/cli/src/app-shell/loading-shell.tsx`
- Modify: `apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts`

- [ ] **Step 1: Write failing tests for stage rail rendering**

Append to `apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts`:

```ts
import { renderStageRail } from "@/app-shell/loading-shell-runtime";

describe("renderStageRail — 4-stage spec", () => {
  test("active stage uses ◐/◓/◑/◒ glyph prefix", () => {
    const items = renderStageRail("finding-stream", null);
    const activeItem = items.find((i) => i.tone === "info" || i.tone === "warning");
    expect(activeItem?.glyph).toMatch(/[◐◓◑◒]/u);
  });

  test("completed stages show ✓ prefix", () => {
    const items = renderStageRail("preparing-player", null);
    const done = items.filter((i) => i.tone === "success");
    expect(done.length).toBeGreaterThan(0);
    done.forEach((i) => expect(i.glyph).toBe("✓"));
  });

  test("pending stages show · prefix in dim tone", () => {
    const items = renderStageRail("finding-stream", null);
    const pending = items.filter((i) => i.tone === "neutral");
    expect(pending.length).toBeGreaterThan(0);
    pending.forEach((i) => expect(i.glyph).toBe("·"));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts`
Expected: FAIL — `glyph` property not on stage rail items

- [ ] **Step 3: Update `LoadingShellStage` type**

In `apps/cli/src/app-shell/types.ts`:

```ts
export type LoadingShellStage =
  | "finding-stream" // ◐ Resolving
  | "preparing-provider" // ◓ Providers  (new)
  | "preparing-player" // ◑ Stream
  | "starting-playback"; // ◒ Player
```

- [ ] **Step 4: Update `renderStageRail` in `loading-shell-runtime.ts`**

The function must return items with a `glyph` field. Replace the current implementation with:

```ts
const STAGE_ORDER: LoadingShellStage[] = [
  "finding-stream",
  "preparing-provider",
  "preparing-player",
  "starting-playback",
];

const STAGE_GLYPHS: Record<LoadingShellStage, string> = {
  "finding-stream": "◐",
  "preparing-provider": "◓",
  "preparing-player": "◑",
  "starting-playback": "◒",
};

const STAGE_LABELS: Record<LoadingShellStage, string> = {
  "finding-stream": "Resolving",
  "preparing-provider": "Providers",
  "preparing-player": "Stream",
  "starting-playback": "Player",
};

export type StageRailItem = {
  label: string;
  glyph: string;
  tone: "neutral" | "info" | "success" | "warning" | "error";
};

export function renderStageRail(
  activeStage: LoadingShellStage,
  issue: string | null,
): StageRailItem[] {
  const activeIdx = STAGE_ORDER.indexOf(activeStage);
  return STAGE_ORDER.map((stage, i) => {
    if (i < activeIdx) {
      return { label: STAGE_LABELS[stage], glyph: "✓", tone: "success" };
    }
    if (i === activeIdx) {
      return {
        label: STAGE_LABELS[stage],
        glyph: STAGE_GLYPHS[stage],
        tone: issue ? "warning" : "info",
      };
    }
    return { label: STAGE_LABELS[stage], glyph: "·", tone: "neutral" };
  });
}
```

- [ ] **Step 5: Update `StageRail` component in `loading-shell.tsx`**

Update the `StageRail` component to use `item.glyph` instead of hard-coded conditionals:

```tsx
function StageRail({ items }: { items: readonly StageRailItem[] }) {
  return (
    <Box flexDirection="row">
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 ? (
            <Text color={palette.dim} dimColor>
              {"  "}
            </Text>
          ) : null}
          <Text
            color={
              item.tone === "success"
                ? palette.green
                : item.tone === "info"
                  ? palette.amber
                  : item.tone === "warning"
                    ? palette.amber
                    : palette.dim
            }
            dimColor={item.tone === "neutral"}
          >
            {item.glyph} {item.label}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `bun run test apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/types.ts apps/cli/src/app-shell/loading-shell-runtime.ts apps/cli/src/app-shell/loading-shell.tsx apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts
git commit -m "feat(loading): 4-stage rail with ◐◓◑◒ glyphs per spec"
```

---

### Task 7: Post-playback state machine (pure logic)

Extract the post-playback decision logic into a pure function so it can be tested without rendering.

**Files:**

- Create: `apps/cli/src/domain/playback/post-play-state.ts`
- Create: `apps/cli/test/unit/domain/post-play-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/test/unit/domain/post-play-state.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { resolvePostPlayState } from "@/domain/playback/post-play-state";

describe("resolvePostPlayState", () => {
  test("mid-series: more episodes in season → state is 'mid-series'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: true,
      isSeasonFinale: false,
      isSeriesComplete: false,
      isCaughtUpOnAiring: false,
    });
    expect(state.kind).toBe("mid-series");
  });

  test("caught-up: current on airing show, no next episode yet → 'caught-up'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: false,
      isSeriesComplete: false,
      isCaughtUpOnAiring: true,
      nextAirDate: "2026-05-30",
    });
    expect(state.kind).toBe("caught-up");
    expect(state.nextAirDate).toBe("2026-05-30");
  });

  test("season-finale: last ep of season, next season available → 'season-finale'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: true,
      isSeriesComplete: false,
      isCaughtUpOnAiring: false,
      hasNextSeason: true,
    });
    expect(state.kind).toBe("season-finale");
  });

  test("series-complete: last ep of last season → 'series-complete'", () => {
    const state = resolvePostPlayState({
      hasNextEpisode: false,
      isSeasonFinale: true,
      isSeriesComplete: true,
      isCaughtUpOnAiring: false,
    });
    expect(state.kind).toBe("series-complete");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test apps/cli/test/unit/domain/post-play-state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the pure function**

Create `apps/cli/src/domain/playback/post-play-state.ts`:

```ts
export type PostPlayInput = {
  readonly hasNextEpisode: boolean;
  readonly isSeasonFinale: boolean;
  readonly isSeriesComplete: boolean;
  readonly isCaughtUpOnAiring: boolean;
  readonly hasNextSeason?: boolean;
  readonly nextAirDate?: string;
};

export type PostPlayState =
  | { kind: "mid-series" }
  | { kind: "caught-up"; nextAirDate?: string }
  | { kind: "season-finale"; hasNextSeason: boolean }
  | { kind: "series-complete" };

export function resolvePostPlayState(input: PostPlayInput): PostPlayState {
  if (input.isSeriesComplete) {
    return { kind: "series-complete" };
  }
  if (input.isCaughtUpOnAiring) {
    return { kind: "caught-up", nextAirDate: input.nextAirDate };
  }
  if (input.isSeasonFinale) {
    return { kind: "season-finale", hasNextSeason: input.hasNextSeason ?? false };
  }
  return { kind: "mid-series" };
}
```

- [ ] **Step 4: Run to verify passing**

Run: `bun run test apps/cli/test/unit/domain/post-play-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/post-play-state.ts apps/cli/test/unit/domain/post-play-state.test.ts
git commit -m "feat(domain): post-playback 4-state machine as pure function"
```

---

### Task 8: Post-playback shell component (4 states)

**Files:**

- Create: `apps/cli/src/app-shell/post-play-shell.tsx`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (integrate)

- [ ] **Step 1: Create the shell component**

Create `apps/cli/src/app-shell/post-play-shell.tsx`:

```tsx
import { Box, Text, useInput } from "ink";
import React from "react";

import type { PostPlayState } from "@/domain/playback/post-play-state";
import type { PlaybackRecommendationRailItem } from "./types";
import { palette } from "./shell-theme";
import { truncateLine } from "./shell-text";

type PostPlayShellProps = {
  title: string;
  episodeLabel: string; // "S01 E04 — Episode Title"
  nextEpisodeLabel?: string; // "S01 E05 — Next Title"
  posterUrl?: string;
  postPlayState: PostPlayState;
  recommendations?: readonly PlaybackRecommendationRailItem[];
  totalEpisodes?: number;
  watchedEpisodes?: number;
  currentSeason?: number;
  onContinue?: () => void;
  onNextSeason?: () => void;
  onWatchlist?: () => void;
  onQuit?: () => void;
  onRecommendation?: (item: PlaybackRecommendationRailItem) => void;
};

export const PostPlayShell = React.memo(function PostPlayShell({
  title,
  episodeLabel,
  nextEpisodeLabel,
  postPlayState,
  recommendations = [],
  totalEpisodes,
  watchedEpisodes,
  currentSeason,
  onContinue,
  onNextSeason,
  onWatchlist,
  onQuit,
  onRecommendation,
}: PostPlayShellProps) {
  const [recIndex, setRecIndex] = React.useState(0);

  useInput((input, key) => {
    if (key.return || input === "c") {
      if (postPlayState.kind === "mid-series") onContinue?.();
      if (postPlayState.kind === "season-finale") onNextSeason?.();
    }
    if (input === "w") onWatchlist?.();
    if (input === "q" || key.escape) onQuit?.();
    if ((key.leftArrow || input === "h") && recIndex > 0) setRecIndex((i) => i - 1);
    if ((key.rightArrow || input === "l") && recIndex < recommendations.length - 1)
      setRecIndex((i) => i + 1);
    if (key.return && postPlayState.kind === "series-complete" && recommendations[recIndex]) {
      onRecommendation?.(recommendations[recIndex]);
    }
  });

  const progress =
    totalEpisodes && watchedEpisodes
      ? Math.round((watchedEpisodes / totalEpisodes) * 100)
      : undefined;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header context strip */}
      <Box marginBottom={1}>
        <Text color={palette.muted} dimColor>
          {title}
          {episodeLabel ? `  ·  ${episodeLabel}` : ""}
        </Text>
      </Box>

      {/* State-specific primary zone */}
      {postPlayState.kind === "mid-series" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.amber}>↵ continue</Text>
          {nextEpisodeLabel && (
            <Text color={palette.text} dimColor>
              {"   "}
              {truncateLine(nextEpisodeLabel, 60)}
            </Text>
          )}
        </Box>
      )}

      {postPlayState.kind === "caught-up" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.teal}>◉ caught up</Text>
          {postPlayState.nextAirDate && (
            <Text color={palette.muted}>
              {"   next episode "}
              {postPlayState.nextAirDate}
            </Text>
          )}
          <Box marginTop={1}>
            <Text color={palette.amber}>w </Text>
            <Text color={palette.dim}>add to watchlist to get notified</Text>
          </Box>
        </Box>
      )}

      {postPlayState.kind === "season-finale" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.green}>✦ Season {currentSeason} complete</Text>
          {postPlayState.hasNextSeason && (
            <Box marginTop={1}>
              <Text color={palette.amber}>↵ continue to next season</Text>
            </Box>
          )}
          {progress !== undefined && (
            <Box marginTop={1}>
              <Text color={palette.dim}>
                {watchedEpisodes} of {totalEpisodes} eps · {progress}%
              </Text>
            </Box>
          )}
        </Box>
      )}

      {postPlayState.kind === "series-complete" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.purple}>✦ you finished {title}</Text>
          {totalEpisodes && currentSeason && (
            <Text color={palette.dim}>
              {totalEpisodes} episodes across {currentSeason} seasons
            </Text>
          )}
        </Box>
      )}

      {/* Recommendations (secondary zone — always quiet) */}
      {recommendations.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.dim}>
            {postPlayState.kind === "series-complete"
              ? "because you finished this"
              : "you might also like"}
          </Text>
          <Box marginTop={1} flexDirection="row" flexWrap="nowrap">
            {recommendations.slice(0, 4).map((rec, i) => (
              <Box key={rec.id} marginRight={3}>
                <Text
                  color={
                    i === recIndex && postPlayState.kind === "series-complete"
                      ? palette.amber
                      : palette.text
                  }
                >
                  {truncateLine(rec.title, 20)}
                </Text>
              </Box>
            ))}
          </Box>
          {postPlayState.kind === "series-complete" && recommendations.length > 0 && (
            <Box marginTop={1}>
              <Text color={palette.dim}>← → browse · ↵ play</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Footer hint */}
      <Box marginTop={2}>
        <Text color={palette.dim} dimColor>
          {postPlayState.kind === "mid-series"
            ? "↵ continue  q quit  / commands"
            : postPlayState.kind === "caught-up"
              ? "w watchlist  q quit  / commands"
              : postPlayState.kind === "season-finale"
                ? "↵ continue  q quit  / commands"
                : "↵ play recommendation  q quit  / commands"}
        </Text>
      </Box>
    </Box>
  );
});
```

- [ ] **Step 2: Wire into `ink-shell.tsx`**

Find where `PlaybackShellState.showRecommendationNudge` drives the post-play UI. Replace or augment that path to render `PostPlayShell` when the playback phase ends, passing a `PostPlayState` derived from `resolvePostPlayState(...)`.

The exact wiring depends on `PlaybackPhase.ts` — look for where `resolvePostPlaybackSessionAction` is called and where the post-play render happens. Pass the resolved 4-state to `PostPlayShell`.

- [ ] **Step 3: Manual verification**

Run: `bun run dev -- -S "Attack on Titan"`
Play an episode. After it ends, verify the post-play shell shows "↵ continue" with the next episode.

- [ ] **Step 4: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/post-play-shell.tsx
git commit -m "feat(post-play): 4-state post-playback shell (mid-series/caught-up/finale/complete)"
```

---

### Task 9: Episode picker — context strip with series/season/progress

The episode picker currently has no series-level context visible. Add a context strip below the header showing: series name · season · episode count · progress.

**Files:**

- Modify: `apps/cli/src/app-shell/pickers/tmdb-season-episode-pickers.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (episode picker render)

- [ ] **Step 1: Locate the episode picker render**

Run: `grep -n "EpisodePicker\|episode.*picker\|pick.*episode\|tmdb-season" apps/cli/src/app-shell/ink-shell.tsx | head -20`

Identify the component that renders episode rows.

- [ ] **Step 2: Add context strip to episode picker header**

The picker uses `ShellFrame` with a `subtitle` prop. Update the subtitle to include the context strip format:

```ts
// In the episode picker title/subtitle derivation:
const episodePickerSubtitle = [
  series.name,
  `S${String(selectedSeason).padStart(2, "0")}`,
  `${totalEpisodes} eps`,
  progress ? `${progress}% complete` : null,
]
  .filter(Boolean)
  .join("  ·  ");
```

Pass this as the `subtitle` to `ShellFrame`.

- [ ] **Step 3: Add progress indicator to each episode row**

Each episode row should show a dim progress bar after the title:

```ts
// In the option label formatter for episode picker rows:
const progressFill =
  watchedPercent > 0
    ? "█".repeat(Math.floor(watchedPercent / 10)) + "░".repeat(10 - Math.floor(watchedPercent / 10))
    : undefined;
```

Add this as the `detail` field on `ShellPickerOption`.

- [ ] **Step 4: Typecheck + manual test**

Run: `bun run typecheck`
Run: `bun run dev -- -S "Attack on Titan"` → open episode picker with `e`
Expected: header shows `Attack on Titan · S01 · 24 eps`, each row shows progress bar if watched.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/pickers/tmdb-season-episode-pickers.ts apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat(picker): episode picker context strip with series/season/progress"
```

---

## Phase 3 — Browse, History & Details

### Task 10: Browse shell layout and empty states

**Files:**

- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (browse shell render)

- [ ] **Step 1: Use `ShellViewportBreakpoint` to gate companion visibility**

Find where `wideBrowse` / `mediumBrowse` gate the companion pane. Update to use `policy.breakpoint`:

```tsx
const policy = useViewportPolicy("browse");
const showCompanion = policy.breakpoint === "wide" || policy.breakpoint === "medium";
const showPoster = policy.breakpoint === "wide";
const showFooterCompact = policy.breakpoint === "narrow" || policy.breakpoint === "blocked";
```

- [ ] **Step 2: Update filter chips to underline style**

Browse filter tabs currently render as text. Make active filter use `palette.amber` and underline indicator via a `─` rule:

```tsx
// Filter chip row
{
  filters.map((filter) => (
    <Box key={filter.key} marginRight={2} flexDirection="column">
      <Text color={filter.active ? palette.amber : palette.dim}>{filter.label}</Text>
      {filter.active && <Text color={palette.amber}>{"─".repeat(filter.label.length)}</Text>}
    </Box>
  ));
}
```

- [ ] **Step 3: Add typed empty states**

In the browse result section, when results are empty:

```tsx
{
  results.length === 0 && query.trim().length > 0 && (
    <Box marginTop={2} flexDirection="column">
      <Text color={palette.dim}>◌ no results for "{query}"</Text>
      <Text color={palette.dim} dimColor>
        try a different title or browse by genre
      </Text>
    </Box>
  );
}
{
  results.length === 0 && query.trim().length === 0 && isFirstLaunch && (
    <Box marginTop={2} flexDirection="column">
      <Text color={palette.amber}>◈ welcome to kunai</Text>
      <Text color={palette.dim}>search for a title to begin</Text>
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          /discover for recommendations
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Typecheck + manual test**

Run: `bun run typecheck`
Run: `bun run dev` → search for a nonexistent title.
Expected: "◌ no results for..." message.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat(browse): breakpoint-aware layout, filter chips, typed empty states"
```

---

### Task 11: History poster hash-color fallback system

**Files:**

- Modify: `apps/cli/src/app-shell/poster-renderer.ts`
- Create test additions in: `apps/cli/test/unit/app-shell/poster-renderer.test.ts`

- [ ] **Step 1: Write failing tests for hash-color selection**

Append to `apps/cli/test/unit/app-shell/poster-renderer.test.ts`:

```ts
import { hashTitleToColor } from "@/app-shell/poster-renderer";

describe("hashTitleToColor", () => {
  test("returns one of the 4 palette colors for any string", () => {
    const validColors = ["amber", "teal", "purple", "pink"] as const;
    expect(validColors).toContain(hashTitleToColor("Attack on Titan"));
    expect(validColors).toContain(hashTitleToColor("Demon Slayer"));
    expect(validColors).toContain(hashTitleToColor(""));
  });

  test("same title always returns the same color", () => {
    const color1 = hashTitleToColor("Vinland Saga");
    const color2 = hashTitleToColor("Vinland Saga");
    expect(color1).toBe(color2);
  });

  test("different titles usually return different colors", () => {
    const titles = ["Attack on Titan", "Demon Slayer", "Frieren", "Solo Leveling", "Berserk"];
    const colors = titles.map(hashTitleToColor);
    const unique = new Set(colors);
    // At least 2 distinct colors across 5 titles
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test apps/cli/test/unit/app-shell/poster-renderer.test.ts`
Expected: FAIL — `hashTitleToColor` not exported

- [ ] **Step 3: Implement `hashTitleToColor` in poster-renderer.ts**

Read the current `poster-renderer.ts` first (`apps/cli/src/app-shell/poster-renderer.ts`), then append:

```ts
type PosterFallbackColor = "amber" | "teal" | "purple" | "pink";
const POSTER_COLORS: PosterFallbackColor[] = ["amber", "teal", "purple", "pink"];

export function hashTitleToColor(title: string): PosterFallbackColor {
  let hash = 5381;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) + hash) ^ title.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return POSTER_COLORS[hash % POSTER_COLORS.length];
}
```

- [ ] **Step 4: Create `PosterInitialBlock` component**

In `poster-renderer.ts` (or a new `history-poster.tsx`), export a component that renders the hash-color initial block when no real image is available:

```tsx
export function PosterInitialBlock({
  title,
  width = 10,
  height = 6,
}: {
  title: string;
  width?: number;
  height?: number;
}) {
  const colorKey = hashTitleToColor(title);
  const color =
    colorKey === "amber"
      ? palette.amber
      : colorKey === "teal"
        ? palette.teal
        : colorKey === "purple"
          ? palette.purple
          : palette.pink;
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  const pad = Math.max(0, Math.floor((height - 1) / 2));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {Array.from({ length: pad }).map((_, i) => (
        <Text key={i} color={color} dimColor>
          {" ".repeat(width)}
        </Text>
      ))}
      <Text color={color} bold>
        {" ".repeat(Math.max(0, Math.floor((width - 1) / 2)))}
        {initial}
      </Text>
      {Array.from({ length: height - pad - 1 }).map((_, i) => (
        <Text key={i} color={color} dimColor>
          {" ".repeat(width)}
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `bun run test apps/cli/test/unit/app-shell/poster-renderer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/poster-renderer.ts apps/cli/test/unit/app-shell/poster-renderer.test.ts
git commit -m "feat(poster): hash-color initial block fallback for history thumbnails"
```

---

### Task 12: History panel redesign — grouped sections, progress bars, posters

**Files:**

- Modify: `apps/cli/src/app-shell/ink-shell.tsx` (history shell render)
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (if history lives there)

- [ ] **Step 1: Find the history render location**

Run: `grep -n "history\|History\|watch.*history" apps/cli/src/app-shell/ink-shell.tsx | head -20`
Run: `grep -n "history\|History" apps/cli/src/app-shell/root-overlay-shell.tsx | head -20`

- [ ] **Step 2: Implement grouped section headers**

History items arrive as a flat array from the history service. Group them:

```ts
function groupHistoryByRecency(items: HistoryItem[]): { label: string; items: HistoryItem[] }[] {
  const now = Date.now();
  const DAY_MS = 86_400_000;
  const today: HistoryItem[] = [];
  const week: HistoryItem[] = [];
  const earlier: HistoryItem[] = [];

  for (const item of items) {
    const age = now - item.watchedAt;
    if (age < DAY_MS) today.push(item);
    else if (age < DAY_MS * 7) week.push(item);
    else earlier.push(item);
  }

  return [
    ...(today.length ? [{ label: "Today", items: today }] : []),
    ...(week.length ? [{ label: "This Week", items: week }] : []),
    ...(earlier.length ? [{ label: "Earlier", items: earlier }] : []),
  ];
}
```

- [ ] **Step 3: Render each history row with poster + progress**

For each history item in the grouped list:

```tsx
function HistoryRow({ item, isSelected }: { item: HistoryItem; isSelected: boolean }) {
  const progressPct = item.progress ?? 0;
  const filled = Math.floor(progressPct / 4); // out of 25
  const bar = "█".repeat(filled) + "░".repeat(25 - filled);
  const isComplete = progressPct >= 90;

  return (
    <Box marginBottom={1}>
      {/* Poster / initial block (small inline) */}
      <Box marginRight={2} width={6}>
        {item.posterPath ? (
          <Text color={palette.dim}>[img]</Text> // poster protocol handled by usePosterPreview
        ) : (
          <Text color={hashTitleToColor(item.title) === "amber" ? palette.amber : palette.teal}>
            {item.title.charAt(0).toUpperCase()}
          </Text>
        )}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text color={isSelected ? palette.amber : palette.text} bold={isSelected}>
            {truncateLine(item.title, 40)}
          </Text>
          <Text color={isComplete ? palette.green : palette.amber}>
            {isComplete ? "complete" : `${progressPct}%`}
          </Text>
        </Box>
        <Text color={palette.dim}>{item.episodeLabel}</Text>
        <Box>
          <Text color={isComplete ? palette.green : palette.amber} dimColor={!isSelected}>
            {bar}
          </Text>
          <Text color={palette.dim}> {progressPct}%</Text>
        </Box>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Typecheck + manual test**

Run: `bun run typecheck`
Run: `bun run dev -- /history`
Expected: grouped sections (Today / This Week / Earlier), progress bars, colored status.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat(history): grouped sections, progress bars, poster initial blocks"
```

---

### Task 13: Details panel — two zones with shimmer

**Files:**

- Modify: `apps/cli/src/app-shell/details-panel.ts` (data model)
- Create: `apps/cli/src/app-shell/details-pane-ui.tsx` (2-zone UI component)

- [ ] **Step 1: Check existing details panel data model**

Read `apps/cli/src/app-shell/details-panel.ts` (the existing file, 34+ lines per test listing). Identify what data is already available vs what requires an async fetch.

- [ ] **Step 2: Define two-zone data type**

In `details-panel.ts`, ensure the data type separates instant and lazy fields:

```ts
export type DetailsPanelPrimary = {
  title: string;
  type: "movie" | "series";
  year?: string;
  genres?: string[];
  synopsis?: string;
  posterPath?: string | null;
};

export type DetailsPanelSecondary = {
  seriesState: "airing" | "ended" | "complete" | "upcoming" | null;
  nextAirDate?: string;
  watchedEpisodes?: number;
  totalEpisodes?: number;
  providers?: string[];
  subtitleLanguages?: string[];
};

export type DetailsPanelData = {
  primary: DetailsPanelPrimary;
  secondary: DetailsPanelSecondary | null; // null = still loading
};
```

- [ ] **Step 3: Create `DetailsPaneUI` component**

Create `apps/cli/src/app-shell/details-pane-ui.tsx`:

```tsx
import { Box, Text } from "ink";
import React from "react";

import type { DetailsPanelData, DetailsPanelSecondary } from "./details-panel";
import { PosterInitialBlock } from "./poster-renderer";
import { palette } from "./shell-theme";
import { truncateLine } from "./shell-text";

const SERIES_STATE_COLORS: Record<NonNullable<DetailsPanelSecondary["seriesState"]>, string> = {
  airing: palette.teal,
  ended: palette.green,
  complete: palette.purple,
  upcoming: palette.amber,
};

const SERIES_STATE_LABELS: Record<NonNullable<DetailsPanelSecondary["seriesState"]>, string> = {
  airing: "◉ airing",
  ended: "✦ ended",
  complete: "✦ you finished this",
  upcoming: "upcoming",
};

function SecondaryZoneShimmer() {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.faint} dimColor>
        {"░".repeat(28)}
      </Text>
      <Text color={palette.faint} dimColor>
        {"░".repeat(20)}
      </Text>
      <Text color={palette.faint} dimColor>
        {"░".repeat(24)}
      </Text>
    </Box>
  );
}

export function DetailsPaneUI({ data, width = 36 }: { data: DetailsPanelData; width?: number }) {
  const { primary, secondary } = data;

  return (
    <Box flexDirection="column" width={width}>
      {/* Zone 1: Primary — instant */}
      <Box marginBottom={1}>
        {primary.posterPath ? (
          <Text color={palette.dim}>[poster]</Text>
        ) : (
          <PosterInitialBlock title={primary.title} width={8} height={4} />
        )}
      </Box>
      <Text color={palette.text} bold>
        {truncateLine(primary.title, width - 2)}
      </Text>
      <Text color={palette.dim}>
        {[primary.type, primary.year, ...(primary.genres?.slice(0, 2) ?? [])]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {primary.synopsis && (
        <Box marginTop={1}>
          <Text color={palette.muted}>{truncateLine(primary.synopsis, (width - 2) * 3)}</Text>
        </Box>
      )}

      {/* Zone 2: Secondary — lazy */}
      {secondary === null ? (
        <SecondaryZoneShimmer />
      ) : (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={
            secondary.seriesState ? SERIES_STATE_COLORS[secondary.seriesState] : palette.dim
          }
        >
          {secondary.seriesState && (
            <Text color={SERIES_STATE_COLORS[secondary.seriesState]}>
              {"│ "}
              {SERIES_STATE_LABELS[secondary.seriesState]}
              {secondary.nextAirDate ? `  ·  ${secondary.nextAirDate}` : ""}
            </Text>
          )}
          {secondary.watchedEpisodes !== undefined && secondary.totalEpisodes !== undefined && (
            <Text color={palette.muted}>
              {"   "}
              {secondary.watchedEpisodes} of {secondary.totalEpisodes} eps
            </Text>
          )}
          {secondary.providers && secondary.providers.length > 0 && (
            <Text color={palette.dim}>
              {"   "}
              {secondary.providers.join("  ·  ")}
            </Text>
          )}
          {secondary.subtitleLanguages && secondary.subtitleLanguages.length > 0 && (
            <Text color={palette.dim}>
              {"   sub  "}
              {secondary.subtitleLanguages.join("  ·  ")}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Wire into browse companion pane**

In `ink-shell.tsx`, where the companion pane renders, replace the existing details render with `<DetailsPaneUI data={...} />`. Pass `secondary={null}` initially and fill it when the async fetch resolves.

- [ ] **Step 5: Typecheck + manual test**

Run: `bun run typecheck`
Run: `bun run dev -- -S "Attack on Titan"` → select a result.
Expected: companion pane shows title, genres, synopsis instantly; series state banner and provider info appears after a short delay (shimmer visible briefly).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/details-panel.ts apps/cli/src/app-shell/details-pane-ui.tsx apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat(details): two-zone panel with shimmer placeholders and series state banner"
```

---

## Phase 4 — Supporting Surfaces

### Task 14: Settings panel — indicator dots and Danger Zone

**Files:**

- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (or wherever settings renders)

- [ ] **Step 1: Find the settings render**

Run: `grep -n "settings\|Settings" apps/cli/src/app-shell/root-overlay-shell.tsx | head -20`

- [ ] **Step 2: Implement indicator dot helper**

```ts
function settingDot(value: boolean, hasWarning = false, isDanger = false): string {
  if (isDanger) return "●";
  if (hasWarning) return "●";
  return "●";
}

function settingDotColor(value: boolean, hasWarning = false, isDanger = false): string {
  if (isDanger) return palette.red;
  if (hasWarning) return palette.amber;
  return value ? palette.green : palette.dim;
}
```

- [ ] **Step 3: Render settings sections with dots**

For each settings row:

```tsx
<Box key={setting.key}>
  <Text color={settingDotColor(setting.value, setting.warning, setting.danger)}>● </Text>
  <Text color={palette.text}>{setting.label}</Text>
  <Text color={palette.dim}>{setting.value ? "  on" : "  off"}</Text>
</Box>
```

Section headers in amber uppercase:

```tsx
<Box flexDirection="column">
  <Text color={palette.amber}>{section.title.toUpperCase()}</Text>
  <Text color={palette.dim}>{"─".repeat(40)}</Text>
</Box>
```

- [ ] **Step 4: Add Danger Zone section**

```tsx
{
  /* Danger Zone */
}
<Box marginTop={2} flexDirection="column">
  <Text color={palette.red}>{"══════════ DANGER ZONE ══════════"}</Text>
  <Text color={palette.dim}>{"─".repeat(40)}</Text>
  {dangerActions.map((action) => (
    <Box key={action.key}>
      <Text color={palette.red}>● </Text>
      <Text color={palette.text}>{action.label}</Text>
    </Box>
  ))}
</Box>;
```

- [ ] **Step 5: Typecheck + manual test**

Run: `bun run typecheck`
Run: `bun run dev -- /settings`
Expected: green/gray dots per setting, amber section headers, red Danger Zone at bottom.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/root-overlay-shell.tsx
git commit -m "feat(settings): indicator dots, amber section headers, Danger Zone"
```

---

### Task 15: Calendar — day strip with ◉/● markers and time-slotted rows

**Files:**

- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (calendar render)

- [ ] **Step 1: Build the day strip data helper**

```ts
export function buildDayStrip(
  selectedDate: Date,
  today: Date,
): {
  date: Date;
  isToday: boolean;
  isSelected: boolean;
  label: string;
}[] {
  const days = [-3, -2, -1, 0, 1, 2, 3].map((offset) => {
    const d = new Date(selectedDate);
    d.setDate(selectedDate.getDate() + offset);
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const isSelected = d.toDateString() === selectedDate.toDateString();
    const label = d.toLocaleDateString("en", { weekday: "short" });
    return { date: d, isToday, isSelected, label };
  });
  return days;
}
```

- [ ] **Step 2: Render the day strip**

```tsx
<Box flexDirection="row" marginBottom={1}>
  <Text color={palette.dim}>← </Text>
  {days.map((day) => (
    <Box key={day.date.toISOString()} marginRight={2}>
      <Text
        color={day.isToday ? palette.amber : day.isSelected ? palette.teal : palette.dim}
        bold={day.isSelected}
      >
        {day.isToday ? "◉" : day.isSelected ? "●" : " "}
        {day.label}
      </Text>
    </Box>
  ))}
  <Text color={palette.dim}> →</Text>
</Box>
```

- [ ] **Step 3: Render time-slotted rows**

Group calendar entries by local time:

```tsx
{
  Object.entries(slotsByTime).map(([time, entries]) => (
    <Box key={time} flexDirection="column" marginBottom={1}>
      <Text color={palette.dim}>{time.padEnd(9)}</Text>
      {entries.map((entry) => (
        <Box key={entry.id} paddingLeft={2}>
          <Text color={palette.amber}>▸ </Text>
          <Text color={palette.text}>{entry.title}</Text>
          <Text color={palette.dim}> {entry.episodeLabel}</Text>
        </Box>
      ))}
    </Box>
  ));
}
```

- [ ] **Step 4: Add ← → key navigation**

```ts
useInput((input, key) => {
  if (key.leftArrow || input === "h")
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(d.getDate() - 1);
      return next;
    });
  if (key.rightArrow || input === "l")
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      return next;
    });
});
```

- [ ] **Step 5: Add type filter tabs (Anime / TV / Movies)**

```tsx
<Box marginBottom={1}>
  {["All", "Anime", "TV", "Movies"].map((tab) => (
    <Box key={tab} marginRight={3} flexDirection="column">
      <Text color={activeTab === tab ? palette.amber : palette.dim}>{tab}</Text>
      {activeTab === tab && <Text color={palette.amber}>{"─".repeat(tab.length)}</Text>}
    </Box>
  ))}
</Box>
```

- [ ] **Step 6: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/root-overlay-shell.tsx
git commit -m "feat(calendar): day strip with ◉/● markers, time-slotted rows, type tabs"
```

---

### Task 16: Help menu — 4 tabbed sections

**Files:**

- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (help render)

- [ ] **Step 1: Define the 4 tab contents**

```ts
const HELP_TABS = {
  Navigation: [
    { key: "↑↓  jk", desc: "move through list" },
    { key: "enter", desc: "select / play" },
    { key: "esc  q", desc: "back / quit" },
    { key: "/", desc: "open command palette" },
    { key: "tab", desc: "toggle mode (anime / series)" },
  ],
  Playback: [
    { key: "space", desc: "pause / resume" },
    { key: "← →", desc: "seek 5 seconds" },
    { key: "[ ]", desc: "seek 85 seconds (op skip)" },
    { key: "n  p", desc: "next / previous episode" },
    { key: "s", desc: "cycle subtitle track" },
    { key: "q", desc: "stop and return to browse" },
  ],
  Commands: [
    { key: "/history", desc: "watch history" },
    { key: "/continue", desc: "continue watching" },
    { key: "/discover", desc: "recommendations" },
    { key: "/calendar", desc: "airing schedule" },
    { key: "/settings", desc: "preferences" },
    { key: "/diagnostics", desc: "system diagnostics" },
  ],
  About: [
    { key: "version", desc: APP_VERSION },
    { key: "runtime", desc: "Bun + Ink" },
    { key: "repo", desc: "github.com/kitsunelabs/kunai" },
  ],
} as const;
```

- [ ] **Step 2: Render tabbed help**

```tsx
function HelpShell() {
  const tabs = Object.keys(HELP_TABS) as (keyof typeof HELP_TABS)[];
  const [activeTab, setActiveTab] = useState<keyof typeof HELP_TABS>("Navigation");

  useInput((input, key) => {
    if (key.tab) {
      const idx = tabs.indexOf(activeTab);
      setActiveTab(tabs[(idx + 1) % tabs.length]);
    }
    if (key.escape || input === "q") onClose();
  });

  return (
    <Box flexDirection="column">
      {/* Tab strip */}
      <Box marginBottom={1}>
        {tabs.map((tab) => (
          <Box key={tab} marginRight={3} flexDirection="column">
            <Text color={activeTab === tab ? palette.amber : palette.dim}>{tab}</Text>
            {activeTab === tab && <Text color={palette.amber}>{"─".repeat(tab.length)}</Text>}
          </Box>
        ))}
      </Box>
      {/* Tab content */}
      {HELP_TABS[activeTab].map((row) => (
        <Box key={row.key} marginBottom={0}>
          <Text color={palette.amber}>{row.key.padEnd(18)}</Text>
          <Text color={palette.muted}>{row.desc}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          tab switch section · q close
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Typecheck + manual test**

Run: `bun run typecheck`
Run: `bun run dev` → press `?`
Expected: Help opens with 4 tabs, tab key cycles through them.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/root-overlay-shell.tsx
git commit -m "feat(help): 4-tab help menu (Navigation/Playback/Commands/About)"
```

---

### Task 17: Command palette disabled state — muted highlight + reason

**Files:**

- Modify: `apps/cli/src/app-shell/shell-command-ui.tsx`

- [ ] **Step 1: Find the CommandPalette render**

Run: `grep -n "disabled\|reason\|CommandPalette" apps/cli/src/app-shell/shell-command-ui.tsx | head -30`

- [ ] **Step 2: Update disabled item render**

Find where disabled commands are rendered in the palette list. Update to:

- Use `palette.dim` background hint (use `dimColor` prop)
- Show reason text below the command label when highlighted

```tsx
// In the command row render:
{
  command.enabled ? null : (
    <Text color={palette.dim} dimColor>
      {command.reason ?? "unavailable"}
    </Text>
  );
}
```

Make sure disabled items ARE shown in the list (not hidden), just rendered dimmer.

When a disabled item is highlighted, show the reason:

```tsx
{
  isHighlighted && !command.enabled && command.reason && (
    <Box paddingLeft={2}>
      <Text color={palette.dim} dimColor>
        {command.reason}
      </Text>
    </Box>
  );
}
```

- [ ] **Step 3: Typecheck + manual test**

Run: `bun run typecheck`
Run: `bun run dev` → press `/` while not playing → navigate to a playback-only command.
Expected: command is visible but dim, reason text shows when highlighted.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/shell-command-ui.tsx
git commit -m "feat(palette): disabled commands show reason text when highlighted"
```

---

## Phase 5 — Extended Surfaces

### Task 18: Error states — 4 typed scenarios

**Files:**

- Modify: `apps/cli/src/app-shell/root-status-shells.tsx`

- [ ] **Step 1: Define typed error scenarios**

```ts
export type ErrorScenario =
  | { kind: "provider-timeout"; providerName: string; elapsedSec: number }
  | { kind: "stream-broken"; attempt: number; maxAttempts: number }
  | { kind: "network-offline" }
  | { kind: "title-unavailable"; title: string };
```

- [ ] **Step 2: Update `ErrorShell` to render per scenario**

Replace the generic `ErrorShell` with a scenario-aware version:

```tsx
export function ErrorShell({
  scenario,
  onRetry,
  onCancel,
  onWatchlist,
  onLibrary,
}: {
  scenario: ErrorScenario;
  onRetry?: () => void;
  onCancel: () => void;
  onWatchlist?: () => void;
  onLibrary?: () => void;
}) {
  useInput((input, key) => {
    if (input === "r" && onRetry) onRetry();
    if (key.escape || input === "q") onCancel();
    if (input === "w" && onWatchlist) onWatchlist();
    if (input === "l" && onLibrary) onLibrary();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {scenario.kind === "provider-timeout" && (
        <>
          <Text color={palette.amber}>◌ timed out after {scenario.elapsedSec}s</Text>
          <Text color={palette.dim}>{scenario.providerName} did not respond</Text>
          <Box marginTop={1}>
            <Text color={palette.amber}>↻ </Text>
            <Text color={palette.dim}>retry </Text>
            <Text color={palette.dim}>→ try different provider </Text>
            <Text color={palette.dim}>q quit</Text>
          </Box>
        </>
      )}
      {scenario.kind === "stream-broken" && (
        <>
          <Text color={palette.amber}>⚠ stream interrupted · reconnecting...</Text>
          <Text color={palette.dim}>
            attempt {scenario.attempt}/{scenario.maxAttempts}
          </Text>
        </>
      )}
      {scenario.kind === "network-offline" && (
        <>
          <Text color={palette.dim}>○ offline</Text>
          <Box marginTop={1}>
            <Text color={palette.amber}>/library </Text>
            <Text color={palette.dim}>to watch downloaded content</Text>
          </Box>
        </>
      )}
      {scenario.kind === "title-unavailable" && (
        <>
          <Text color={palette.dim}>◌ {scenario.title} not found on any provider</Text>
          <Box marginTop={1}>
            <Text color={palette.amber}>↻ </Text>
            <Text color={palette.dim}>check again </Text>
            <Text color={palette.amber}>w </Text>
            <Text color={palette.dim}>add to watchlist</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/root-status-shells.tsx
git commit -m "feat(errors): 4 typed error scenarios (timeout/broken/offline/unavailable)"
```

---

### Task 19: Onboarding — fast path, blocking dep check, footer size chip

**Files:**

- Modify: `apps/cli/src/app-shell/setup-shell.tsx`
- Modify: `apps/cli/src/app-shell/shell-primitives.tsx` (footer size chip)

- [ ] **Step 1: Update setup shell for fast path vs blocking states**

In `setup-shell.tsx`, differentiate render based on whether all deps are found:

```tsx
// All deps found:
<Box flexDirection="column">
  <Text color={palette.green}>✓ mpv found  ·  ✓ ffmpeg found</Text>
  <Box marginTop={1}>
    <Text color={palette.dim} dimColor>
      ┄  for best experience, use fullscreen (recommended for 80+ col layout)
    </Text>
  </Box>
  <Box marginTop={1}>
    <Text color={palette.amber}>↵ </Text>
    <Text color={palette.dim}>continue</Text>
  </Box>
</Box>

// Missing mpv (blocking):
<Box flexDirection="column">
  <Text color={palette.red}>✕  mpv not found</Text>
  <Text color={palette.muted}>kunai requires mpv to play video.</Text>
  <Box marginTop={1} flexDirection="column">
    <Text color={palette.dim}>macOS    <Text color={palette.teal}>brew install mpv</Text></Text>
    <Text color={palette.dim}>Windows  <Text color={palette.teal}>winget install mpv</Text></Text>
    <Text color={palette.dim}>Linux    <Text color={palette.teal}>sudo apt install mpv</Text></Text>
  </Box>
  <Box marginTop={1}>
    <Text color={palette.amber}>↵ </Text><Text color={palette.dim}>retry after installing</Text>
  </Box>
</Box>
```

- [ ] **Step 2: Add footer size chip**

In `shell-primitives.tsx`, add a `TerminalSizeChip` export:

```tsx
export function TerminalSizeChip({ columns, rows }: { columns: number; rows: number }) {
  const isSuboptimal = columns < 80;
  const isBlocked = columns < 60 || rows < 20;
  const color = isBlocked ? palette.red : isSuboptimal ? palette.amber : palette.dim;
  return (
    <Text color={color} dimColor={!isBlocked && !isSuboptimal}>
      {columns}×{rows}
    </Text>
  );
}
```

Use it in the footer area of the main shell when onboarding is complete.

- [ ] **Step 3: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/setup-shell.tsx apps/cli/src/app-shell/shell-primitives.tsx
git commit -m "feat(onboarding): fast path / blocking dep check, footer terminal size chip"
```

---

### Task 20: Narrow mode — compact footer and resize blocker at <60 cols

The `ResizeBlocker` (updated in Task 4) now accepts `columns` and `rows` as props. This task ensures it fires at <60 cols and that narrow mode (60–79 cols) collapses correctly.

**Files:**

- Modify: `apps/cli/src/app-shell/ink-shell.tsx`

- [ ] **Step 1: Gate resize blocker on `policy.breakpoint === "blocked"`**

Find where `ResizeBlocker` is conditionally rendered. Update condition:

```tsx
if (policy.breakpoint === "blocked") {
  return (
    <ResizeBlocker
      columns={policy.columns}
      rows={policy.rows}
      minColumns={60}
      minRows={20}
      message="terminal too narrow"
    />
  );
}
```

- [ ] **Step 2: Collapse footer to 3 actions in narrow mode**

When `policy.breakpoint === "narrow"`, limit the footer actions array before passing to `ShellFooter`:

```tsx
const narrowFooterActions =
  policy.breakpoint === "narrow" ? footerActions.slice(0, 3) : footerActions;
```

- [ ] **Step 3: Verify the resize blocker shows correct threshold**

Run: `bun run dev -- -S "Dune"` → resize terminal to 59 cols
Expected: "terminal too narrow · resize to at least 60 × 20"

Resize back to 80+ cols: shell returns to normal immediately (SIGWINCH triggers Ink re-render).

- [ ] **Step 4: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/ink-shell.tsx
git commit -m "feat(viewport): resize blocker at <60 cols, compact narrow footer"
```

---

### Task 21: Discover shell — per-section reroll, empty state

**Files:**

- Modify: `apps/cli/src/app-shell/discover-shell.tsx`

- [ ] **Step 1: Find existing discover shell**

Read `apps/cli/src/app-shell/discover-shell.tsx` to understand current structure.

- [ ] **Step 2: Add per-section reroll**

Add a `rerollingSection` state and `r` key handler on section header:

```tsx
const [rerollingSection, setRerollingSection] = useState<string | null>(null);

// In section header render:
<Box justifyContent="space-between">
  <Text color={palette.amber}>{section.title}</Text>
  {focusedSection === section.key && (
    <Text color={palette.dim} dimColor>
      r reroll
    </Text>
  )}
</Box>;

// In input handler:
if (input === "r" && focusedSection) {
  setRerollingSection(focusedSection);
  void reloadSection(focusedSection).then(() => setRerollingSection(null));
}
```

When `rerollingSection === section.key`, show `░░░░░░░░ loading...` for that section only. Other sections remain interactive.

- [ ] **Step 3: Add empty state with fox mascot text**

```tsx
{
  sections.every((s) => s.items.length === 0) && (
    <Box flexDirection="column" paddingY={2}>
      <Text color={palette.amber}>◈ nothing to discover yet</Text>
      <Text color={palette.dim}>watch something first to get recommendations</Text>
      <Box marginTop={1}>
        <Text color={palette.muted} dimColor>
          {" "}
          ^ᵔᴥᵔ^ a fox awaits
        </Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/app-shell/discover-shell.tsx
git commit -m "feat(discover): per-section reroll, empty state with fox mascot"
```

---

### Task 22: Final pass — typecheck, lint, format, build

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Step 2: Lint**

Run: `bun run lint`
Fix any lint errors surfaced.

- [ ] **Step 3: Format**

Run: `bun run fmt`

- [ ] **Step 4: Full test suite**

Run: `bun run test`
Expected: all tests pass (or pre-existing failures only — do not introduce new failures)

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: build completes successfully

- [ ] **Step 6: Commit any final cleanup**

```bash
git add -p  # stage only fmt/lint fixes
git commit -m "chore: typecheck, lint, format pass after launch redesign"
```

---

## Spec Coverage Self-Check

| Spec section                            | Task                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1.1 Color semantic lock (tokens.purple) | Task 1                                                                                     |
| 1.2 Footer typography rules             | Task 3                                                                                     |
| 1.3 Badge rules                         | No code change — enforcement is architectural (don't use Badge where banned)               |
| 1.4 Tabular nums                        | Inline at each site during surface tasks (Tasks 6–21)                                      |
| 1.5 Context strip                       | Tasks 9, 12, 13                                                                            |
| 2.1 Browse shell                        | Task 10                                                                                    |
| 2.2 Post-playback 4 states              | Tasks 7, 8                                                                                 |
| 2.3 Loading screen                      | Task 6                                                                                     |
| 2.4 Active playback                     | Existing LoadingShell (playing state) — signal rail is already in `loading-shell.tsx:714+` |
| 2.5 Episode picker                      | Task 9                                                                                     |
| 2.6 Settings                            | Task 14                                                                                    |
| 2.7 Calendar                            | Task 15                                                                                    |
| 2.8 Help menu                           | Task 16                                                                                    |
| 2.9 History panel                       | Tasks 11, 12                                                                               |
| 2.10 Continue watching                  | Task 12 (history groups handle this)                                                       |
| 2.11 Details panel                      | Task 13                                                                                    |
| 2.12 Command palette disabled           | Task 17                                                                                    |
| 2.13 Diagnostics                        | Existing panel, tabular-nums to apply in Task 22 cleanup                                   |
| 2.14 Discover                           | Task 21                                                                                    |
| 2.15 Downloads/Library                  | See note below                                                                             |
| 2.16 Onboarding                         | Task 19                                                                                    |
| 2.17 Error states                       | Task 18                                                                                    |
| 2.18 Narrow mode                        | Task 20                                                                                    |
| 3.1 Viewport policy                     | Task 2                                                                                     |
| 3.2 Shell frame invariant               | Task 4 (verified, not changed)                                                             |
| 3.3 Exit sequence                       | Task 5                                                                                     |
| 3.4 History poster system               | Task 11                                                                                    |
| AP-1 No bordered status chrome          | Task 3 (footer) + review during Tasks 6–21                                                 |
| AP-5 Box-drawing nesting                | Review during all surface tasks                                                            |

**Downloads/Library gap:** `download-manager-shell.tsx` and `library-shell.tsx` already exist. The spec updates (progress rows, broken artifact `✕` + re-download) are mechanical additions to those files and fit within Task 22 cleanup or a dedicated sub-task if their current state is far from spec.

**Diagnostics tabular-nums gap:** `apps/cli/src/app-shell/root-overlay-shell.tsx` diagnostics section — add `tabular-nums` equivalent (i.e., use monospaced fixed-width number output via `String.padStart`) to all timestamp and memory value renders.

---

## References

- **Spec:** `.docs/launch-redesign-spec.md`
- **Design tokens:** `packages/design/src/tokens.ts`
- **Viewport policy:** `apps/cli/src/app-shell/layout-policy.ts`
- **Shell primitives:** `apps/cli/src/app-shell/shell-primitives.tsx`
- **Shell frame:** `apps/cli/src/app-shell/shell-frame.tsx`
- **Loading shell:** `apps/cli/src/app-shell/loading-shell.tsx`
- **Graceful exit:** `apps/cli/src/app-shell/graceful-exit.ts`
- **Main shell:** `apps/cli/src/app-shell/ink-shell.tsx`
- **Playback phase:** `apps/cli/src/app/PlaybackPhase.ts`
