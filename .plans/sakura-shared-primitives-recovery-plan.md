# Sakura Shared Primitives And Recovery Implementation Plan

> **Status: COMPLETE (2026-05-23).** Tasks 1–10 landed: ContextCard, ActionList, StateBlock, PreviewRail, playback-recovery view model, wired into LoadingShell (recovery surface) and playback/post-play (ContextCard), footer collapse test added. Two bugs in this plan's own sample tests were fixed during implementation (smart initials, robust truncation). typecheck/lint/test (954)/build green. Next: S3 portability, S4 search/tracks/palette, S5 return loop — parallelizable.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared UI primitives and playback recovery surface needed before the rest of the Sakura redesign is parallelized.

**Architecture:** One foundation agent owns shared primitives and S2 recovery first. After this lands, separate agents can safely work on search/details and tracks/command-palette without creating duplicate list, footer, rail, or state handling.

**Tech Stack:** Bun, TypeScript, Ink, existing `apps/cli/src/app-shell/*` shell architecture, `bun:test`.

---

## Implementation Route

Use **one agent for this first slice**.

Do not start with three agents. The first slice touches shared primitives, `LoadingShell`, and shell footer behavior. Splitting that immediately will create file conflicts and inconsistent component APIs.

Recommended ownership:

- **Foundation Agent:** implements this plan.
- **Agent A after foundation:** post-playback, search/details, calendar return loop.
- **Agent B after foundation:** tracks panel, scoped command palette, picker cleanup.

The foundation agent may be this session or a fresh session. A fresh session is cleaner if another agent has local changes in the same files.

## Read First

- `.docs/design-system.md`
- `.plans/sakura-rollout.md`
- `.design/cli/03-component-boundaries.md`
- `.design/cli/missing-surfaces-implementation-map.md`
- `.design/cli/kunai-missing-surfaces-board.html`
- `apps/cli/src/app-shell/shell-primitives.tsx`
- `apps/cli/src/app-shell/shell-frame.tsx`
- `apps/cli/src/app-shell/loading-shell.tsx`
- `apps/cli/src/app-shell/loading-shell-runtime.ts`
- `apps/cli/src/app-shell/post-play-shell.tsx`

## File Structure

Create:

- `apps/cli/src/app-shell/primitives/StateBlock.tsx`
  - Shared loading, empty, success/info, and error block.
- `apps/cli/src/app-shell/primitives/ActionList.tsx`
  - Shared selectable action rows for PPS and recovery surfaces.
- `apps/cli/src/app-shell/primitives/ContextCard.tsx`
  - Compact next/prev/now/related context rows.
- `apps/cli/src/app-shell/primitives/PreviewRail.tsx`
  - Stable poster/facts/details rail.
- `apps/cli/src/app-shell/playback-recovery-view-model.ts`
  - Pure helper that maps `LoadingShellState` to recovery presentation.

Modify:

- `apps/cli/src/app-shell/types.ts`
  - Add shared primitive view-model types only if they are reused across files.
- `apps/cli/src/app-shell/shell-primitives.tsx`
  - Keep `Footer` and `selectFooterActions` here for now. Adjust only if needed for footer collapse rules.
- `apps/cli/src/app-shell/loading-shell.tsx`
  - Consume recovery view model, `StateBlock`, `ActionList`, `PreviewRail`, and `ContextCard`.
- `apps/cli/src/app-shell/post-play-shell.tsx`
  - Use `ContextCard` for next/previous style context if the data is already available. Do not expand PPS redesign beyond that in this slice.

Test:

- `apps/cli/test/unit/app-shell/state-block.test.ts`
- `apps/cli/test/unit/app-shell/action-list.test.ts`
- `apps/cli/test/unit/app-shell/context-card.test.ts`
- `apps/cli/test/unit/app-shell/preview-rail.test.ts`
- `apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts`
- Extend `apps/cli/test/unit/app-shell/shell-primitives.test.ts`
- Extend `apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts` only if timer/wait copy changes.

Do not modify in this slice:

- Search routing.
- Calendar service.
- Tracks capability backend.
- Recommendation service.
- Provider scrapers.
- `packages/design/src/tokens.ts` unless S1 aliases still need deletion in a separate color cleanup.

---

## Task 1: Add `ContextCard` Model Helpers

**Files:**

- Create: `apps/cli/src/app-shell/primitives/ContextCard.tsx`
- Test: `apps/cli/test/unit/app-shell/context-card.test.ts`

- [ ] **Step 1: Write failing tests for compact context behavior**

Create `apps/cli/test/unit/app-shell/context-card.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  buildContextCardTile,
  clampContextCardText,
  contextCardGlyph,
} from "@/app-shell/primitives/ContextCard";

describe("ContextCard helpers", () => {
  test("builds stable initials when thumbnail is missing", () => {
    expect(buildContextCardTile("Challengers of Science")).toBe("CS");
    expect(buildContextCardTile("DR. STONE")).toBe("DS");
    expect(buildContextCardTile("")).toBe("??");
  });

  test("maps state tone to small context glyphs", () => {
    expect(contextCardGlyph({ kind: "next", stateTone: "success" })).toBe("▶");
    expect(
      contextCardGlyph({ kind: "previous", stateLabel: "watched", stateTone: "success" }),
    ).toBe("✓");
    expect(contextCardGlyph({ kind: "next", stateTone: "warning" })).toBe("◷");
    expect(contextCardGlyph({ kind: "related", stateTone: "muted" })).toBe("·");
  });

  test("clamps long titles and subtitles without increasing row height", () => {
    expect(clampContextCardText("A very long episode title that should not wrap", 18)).toBe(
      "A very long epis…",
    );
    expect(clampContextCardText("Short", 18)).toBe("Short");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```sh
bun test apps/cli/test/unit/app-shell/context-card.test.ts
```

Expected: fail because `ContextCard.tsx` does not exist.

- [ ] **Step 3: Add the minimal helper implementation**

Create `apps/cli/src/app-shell/primitives/ContextCard.tsx`:

```tsx
import { Box, Text } from "ink";
import React from "react";

import { truncateLine } from "../shell-text";
import { palette } from "../shell-theme";

export type ContextCardKind = "next" | "previous" | "now" | "related";
export type ContextCardTone = "success" | "warning" | "muted" | "danger";
export type ContextThumbnailState = "none" | "loading" | "ready" | "failed";

export type ContextCardModel = {
  readonly kind: ContextCardKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly thumbnailUrl?: string;
  readonly thumbnailState: ContextThumbnailState;
  readonly stateLabel?: string;
  readonly stateTone?: ContextCardTone;
  readonly actionLabel?: string;
};

export function clampContextCardText(value: string, width: number): string {
  return truncateLine(value, Math.max(1, width));
}

export function buildContextCardTile(title: string): string {
  const words = title
    .trim()
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);

  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]!.slice(0, 1)}${words[1]!.slice(0, 1)}`.toUpperCase();
}

export function contextCardGlyph(
  input: Pick<ContextCardModel, "kind" | "stateLabel" | "stateTone">,
): string {
  if (input.stateTone === "danger") return "×";
  if (input.stateTone === "warning") return "◷";
  if (input.stateTone === "success" && input.kind === "previous") return "✓";
  if (input.stateTone === "success" && input.kind === "next") return "▶";
  if (input.stateLabel?.toLowerCase().includes("watched")) return "✓";
  return "·";
}

export function ContextCard({
  model,
  width = 34,
  selected = false,
}: {
  readonly model: ContextCardModel;
  readonly width?: number;
  readonly selected?: boolean;
}) {
  const tile = buildContextCardTile(model.title);
  const textWidth = Math.max(8, width - 10);
  const glyph = contextCardGlyph(model);
  const toneColor =
    model.stateTone === "success"
      ? palette.ok
      : model.stateTone === "warning"
        ? palette.accentDeep
        : model.stateTone === "danger"
          ? palette.danger
          : palette.dim;

  return (
    <Box width={width} flexDirection="row">
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={palette.accent}>{tile.padEnd(2).slice(0, 2)}</Text>
      <Text color={palette.dim}> </Text>
      <Box flexDirection="column" width={textWidth}>
        <Text color={palette.text} bold>
          {clampContextCardText(model.title, textWidth)}
        </Text>
        {model.subtitle ? (
          <Text color={palette.muted}>{clampContextCardText(model.subtitle, textWidth)}</Text>
        ) : null}
      </Box>
      <Text color={toneColor}>{glyph}</Text>
    </Box>
  );
}

export default ContextCard;
```

- [ ] **Step 4: Run the context card test**

Run:

```sh
bun test apps/cli/test/unit/app-shell/context-card.test.ts
```

Expected: pass.

---

## Task 2: Add `ActionList` And `ActionRow`

**Files:**

- Create: `apps/cli/src/app-shell/primitives/ActionList.tsx`
- Test: `apps/cli/test/unit/app-shell/action-list.test.ts`

- [ ] **Step 1: Write failing tests for action row selection and filtering**

Create `apps/cli/test/unit/app-shell/action-list.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  getEnabledActionRows,
  normalizeActionShortcut,
  type ActionRowModel,
} from "@/app-shell/primitives/ActionList";

describe("ActionList helpers", () => {
  const rows: readonly ActionRowModel[] = [
    { id: "recover", label: "Recover", detail: "Refresh stream", shortcut: "r" },
    { id: "fallback", label: "Fallback", detail: "Try another provider", shortcut: "f" },
    {
      id: "next",
      label: "Next episode",
      detail: "Disabled for unresolved failure",
      shortcut: "n",
      disabledReason: "Playback has not recovered yet",
    },
  ];

  test("filters disabled rows when requested", () => {
    expect(getEnabledActionRows(rows).map((row) => row.id)).toEqual(["recover", "fallback"]);
  });

  test("normalizes shortcuts without brackets", () => {
    expect(normalizeActionShortcut("[shift+enter]")).toBe("shift+enter");
    expect(normalizeActionShortcut("r")).toBe("r");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```sh
bun test apps/cli/test/unit/app-shell/action-list.test.ts
```

Expected: fail because `ActionList.tsx` does not exist.

- [ ] **Step 3: Implement shared action row helpers and component**

Create `apps/cli/src/app-shell/primitives/ActionList.tsx`:

```tsx
import { Box, Text } from "ink";
import React from "react";

import { truncateLine } from "../shell-text";
import { hotkeyLabel, palette } from "../shell-theme";

export type ActionRowTone = "normal" | "success" | "warning" | "danger" | "muted";

export type ActionRowModel = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly shortcut?: string;
  readonly tone?: ActionRowTone;
  readonly disabledReason?: string;
};

export function normalizeActionShortcut(shortcut: string): string {
  return shortcut.replace(/^\[/u, "").replace(/\]$/u, "");
}

export function getEnabledActionRows(rows: readonly ActionRowModel[]): readonly ActionRowModel[] {
  return rows.filter((row) => !row.disabledReason);
}

function toneColor(tone: ActionRowTone | undefined): string {
  if (tone === "success") return palette.ok;
  if (tone === "warning") return palette.accentDeep;
  if (tone === "danger") return palette.danger;
  if (tone === "muted") return palette.dim;
  return palette.text;
}

export function ActionRow({
  row,
  selected = false,
  width = 72,
}: {
  readonly row: ActionRowModel;
  readonly selected?: boolean;
  readonly width?: number;
}) {
  const disabled = Boolean(row.disabledReason);
  const detailWidth = Math.max(10, width - 24);
  return (
    <Box>
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={disabled ? palette.dim : toneColor(row.tone)} bold={!disabled}>
        {truncateLine(row.label, 18).padEnd(18)}
      </Text>
      <Text color={disabled ? palette.dim : palette.muted}>
        {truncateLine(row.disabledReason ?? row.detail ?? "", detailWidth)}
      </Text>
      {row.shortcut ? (
        <Text color={disabled ? palette.dim : palette.accent}>
          {" "}
          {hotkeyLabel(normalizeActionShortcut(row.shortcut))}
        </Text>
      ) : null}
    </Box>
  );
}

export function ActionList({
  rows,
  selectedIndex = 0,
  width = 72,
}: {
  readonly rows: readonly ActionRowModel[];
  readonly selectedIndex?: number;
  readonly width?: number;
}) {
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <ActionRow key={row.id} row={row} selected={index === selectedIndex} width={width} />
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run action list tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/action-list.test.ts
```

Expected: pass.

---

## Task 3: Add `StateBlock`

**Files:**

- Create: `apps/cli/src/app-shell/primitives/StateBlock.tsx`
- Test: `apps/cli/test/unit/app-shell/state-block.test.ts`

- [ ] **Step 1: Write failing tests for state tone and primary action mapping**

Create `apps/cli/test/unit/app-shell/state-block.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { getStateBlockGlyph, getStateBlockTone } from "@/app-shell/primitives/StateBlock";

describe("StateBlock helpers", () => {
  test("maps state kind to glyphs", () => {
    expect(getStateBlockGlyph("loading")).toBe("◐");
    expect(getStateBlockGlyph("empty")).toBe("·");
    expect(getStateBlockGlyph("info")).toBe("●");
    expect(getStateBlockGlyph("success")).toBe("✓");
    expect(getStateBlockGlyph("error")).toBe("×");
  });

  test("maps errors to danger tone and success to ok tone", () => {
    expect(getStateBlockTone("error")).toBe("danger");
    expect(getStateBlockTone("success")).toBe("success");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```sh
bun test apps/cli/test/unit/app-shell/state-block.test.ts
```

Expected: fail because `StateBlock.tsx` does not exist.

- [ ] **Step 3: Implement state block**

Create `apps/cli/src/app-shell/primitives/StateBlock.tsx`:

```tsx
import { Box, Text } from "ink";
import React from "react";

import type { ActionRowModel } from "./ActionList";
import { ActionList } from "./ActionList";
import { palette } from "../shell-theme";

export type StateBlockKind = "loading" | "empty" | "info" | "success" | "error";
export type StateBlockTone = "muted" | "info" | "success" | "danger";

export type StateBlockModel = {
  readonly kind: StateBlockKind;
  readonly title: string;
  readonly detail?: string;
  readonly actions?: readonly ActionRowModel[];
};

export function getStateBlockGlyph(kind: StateBlockKind): string {
  if (kind === "loading") return "◐";
  if (kind === "empty") return "·";
  if (kind === "success") return "✓";
  if (kind === "error") return "×";
  return "●";
}

export function getStateBlockTone(kind: StateBlockKind): StateBlockTone {
  if (kind === "error") return "danger";
  if (kind === "success") return "success";
  if (kind === "info" || kind === "loading") return "info";
  return "muted";
}

function colorForTone(tone: StateBlockTone): string {
  if (tone === "danger") return palette.danger;
  if (tone === "success") return palette.ok;
  if (tone === "info") return palette.accentDeep;
  return palette.dim;
}

export function StateBlock({
  model,
  width = 76,
}: {
  readonly model: StateBlockModel;
  readonly width?: number;
}) {
  const tone = getStateBlockTone(model.kind);
  const color = colorForTone(tone);
  return (
    <Box flexDirection="column">
      <Text color={color} bold>
        {getStateBlockGlyph(model.kind)} {model.title}
      </Text>
      {model.detail ? <Text color={palette.muted}>{model.detail}</Text> : null}
      {model.actions && model.actions.length > 0 ? (
        <Box marginTop={1}>
          <ActionList rows={model.actions} width={width} />
        </Box>
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run state block tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/state-block.test.ts
```

Expected: pass.

---

## Task 4: Add `PreviewRail`

**Files:**

- Create: `apps/cli/src/app-shell/primitives/PreviewRail.tsx`
- Test: `apps/cli/test/unit/app-shell/preview-rail.test.ts`

- [ ] **Step 1: Write failing tests for poster reservation and fact filtering**

Create `apps/cli/test/unit/app-shell/preview-rail.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  getPreviewPosterLabel,
  shouldRenderPreviewRail,
  visiblePreviewFacts,
} from "@/app-shell/primitives/PreviewRail";

describe("PreviewRail helpers", () => {
  test("reserves poster label for loading and failed states", () => {
    expect(getPreviewPosterLabel({ title: "The Boys", posterState: "loading" })).toBe(
      "loading poster",
    );
    expect(getPreviewPosterLabel({ title: "The Boys", posterState: "failed" })).toBe("TB");
    expect(getPreviewPosterLabel({ title: "The Boys", posterState: "none" })).toBe("TB");
  });

  test("hides empty facts", () => {
    expect(
      visiblePreviewFacts([
        { label: "State", value: "available" },
        { label: "Provider", value: "" },
      ]),
    ).toEqual([{ label: "State", value: "available" }]);
  });

  test("collapses rail before list on narrow terminals", () => {
    expect(shouldRenderPreviewRail({ columns: 100, hasModel: true })).toBe(false);
    expect(shouldRenderPreviewRail({ columns: 132, hasModel: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```sh
bun test apps/cli/test/unit/app-shell/preview-rail.test.ts
```

Expected: fail because `PreviewRail.tsx` does not exist.

- [ ] **Step 3: Implement preview rail helpers and component**

Create `apps/cli/src/app-shell/primitives/PreviewRail.tsx`:

```tsx
import { Box, Text } from "ink";
import React from "react";

import { buildContextCardTile } from "./ContextCard";
import { truncateLine } from "../shell-text";
import { palette } from "../shell-theme";

export type PreviewPosterState = "none" | "loading" | "ready" | "failed";

export type PreviewFact = {
  readonly label: string;
  readonly value: string;
  readonly tone?: "success" | "warning" | "danger" | "muted";
};

export type PreviewRailModel = {
  readonly title: string;
  readonly subtitle?: string;
  readonly overview?: string;
  readonly posterUrl?: string;
  readonly posterState: PreviewPosterState;
  readonly facts: readonly PreviewFact[];
};

export function getPreviewPosterLabel(
  input: Pick<PreviewRailModel, "title" | "posterState">,
): string {
  if (input.posterState === "loading") return "loading poster";
  return buildContextCardTile(input.title);
}

export function visiblePreviewFacts(facts: readonly PreviewFact[]): readonly PreviewFact[] {
  return facts.filter((fact) => fact.label.trim().length > 0 && fact.value.trim().length > 0);
}

export function shouldRenderPreviewRail(input: {
  readonly columns: number;
  readonly hasModel: boolean;
}): boolean {
  return input.hasModel && input.columns >= 124;
}

function factColor(tone: PreviewFact["tone"]): string {
  if (tone === "success") return palette.ok;
  if (tone === "warning") return palette.accentDeep;
  if (tone === "danger") return palette.danger;
  return palette.text;
}

export function PreviewRail({
  model,
  width = 32,
}: {
  readonly model: PreviewRailModel;
  readonly width?: number;
}) {
  const facts = visiblePreviewFacts(model.facts).slice(0, 4);
  const posterLabel = getPreviewPosterLabel(model);
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={palette.line}
      paddingX={1}
    >
      <Box minHeight={6} justifyContent="center">
        <Text color={model.posterState === "loading" ? palette.muted : palette.accent} bold>
          {posterLabel}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.text} bold>
          {truncateLine(model.title, width - 2)}
        </Text>
        {model.subtitle ? (
          <Text color={palette.muted}>{truncateLine(model.subtitle, width - 2)}</Text>
        ) : null}
        {model.overview ? (
          <Box marginTop={1}>
            <Text color={palette.dim}>{truncateLine(model.overview, width - 2)}</Text>
          </Box>
        ) : null}
      </Box>
      {facts.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {facts.map((fact) => (
            <Text key={`${fact.label}:${fact.value}`}>
              <Text color={palette.muted}>{truncateLine(fact.label, 10)} </Text>
              <Text color={factColor(fact.tone)}>{truncateLine(fact.value, width - 13)}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 4: Run preview rail tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/preview-rail.test.ts
```

Expected: pass.

---

## Task 5: Add Playback Recovery View Model

**Files:**

- Create: `apps/cli/src/app-shell/playback-recovery-view-model.ts`
- Test: `apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts`

- [ ] **Step 1: Write failing tests for recovery states**

Create `apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { buildPlaybackRecoveryViewModel } from "@/app-shell/playback-recovery-view-model";
import type { LoadingShellState } from "@/app-shell/types";

function baseState(overrides: Partial<LoadingShellState>): LoadingShellState {
  return {
    title: "The Boys",
    subtitle: "S01E01",
    operation: "playing",
    ...overrides,
  };
}

describe("buildPlaybackRecoveryViewModel", () => {
  test("stream stalled promotes recover and fallback without next", () => {
    const model = buildPlaybackRecoveryViewModel(
      baseState({
        bufferHealth: "stalled",
        latestIssue: "Stream stalled",
        fallbackAvailable: true,
        hasNextEpisode: true,
      }),
    );
    expect(model?.state.kind).toBe("error");
    expect(model?.state.title).toBe("Stream stalled");
    expect(model?.actions.map((action) => action.id)).toEqual([
      "recover",
      "fallback",
      "sources",
      "diagnostics",
    ]);
  });

  test("playback did not start never promotes next", () => {
    const model = buildPlaybackRecoveryViewModel(
      baseState({
        operation: "loading",
        latestIssue: "Playback did not start",
        hasNextEpisode: true,
      }),
    );
    expect(model?.actions.some((action) => action.id === "next")).toBe(false);
    expect(model?.state.title).toBe("Playback did not start");
  });

  test("provider degraded is warning, not hard error", () => {
    const model = buildPlaybackRecoveryViewModel(
      baseState({
        operation: "resolving",
        latestIssue: "Provider/CDN may be degraded. Try fallback or open diagnostics.",
        fallbackAvailable: true,
      }),
    );
    expect(model?.state.kind).toBe("info");
    expect(model?.state.title).toBe("Provider degraded");
  });

  test("healthy playback returns null", () => {
    expect(buildPlaybackRecoveryViewModel(baseState({ bufferHealth: "healthy" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```sh
bun test apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts
```

Expected: fail because the view model does not exist.

- [ ] **Step 3: Implement the recovery view model**

Create `apps/cli/src/app-shell/playback-recovery-view-model.ts`:

```ts
import type { ActionRowModel } from "./primitives/ActionList";
import type { StateBlockModel } from "./primitives/StateBlock";
import type { LoadingShellState } from "./types";

export type PlaybackRecoveryViewModel = {
  readonly state: StateBlockModel;
  readonly actions: readonly ActionRowModel[];
};

function normalizedIssue(state: LoadingShellState): string {
  return state.latestIssue?.trim().toLowerCase() ?? "";
}

export function buildPlaybackRecoveryViewModel(
  state: LoadingShellState,
): PlaybackRecoveryViewModel | null {
  const issue = normalizedIssue(state);
  const stalled =
    state.bufferHealth === "stalled" ||
    issue.includes("stream stalled") ||
    issue.includes("ipc stalled") ||
    issue.includes("no playback progress");
  const didNotStart =
    issue.includes("playback did not start") ||
    issue.includes("mpv did not start") ||
    issue.includes("player did not start");
  const noSource =
    issue.includes("no source") ||
    issue.includes("source unavailable") ||
    issue.includes("quality variants unavailable");
  const degraded = issue.includes("degraded") || issue.includes("fallback");

  if (!stalled && !didNotStart && !noSource && !degraded) return null;

  const actions: ActionRowModel[] = [];
  if (stalled || didNotStart || noSource) {
    actions.push({
      id: "recover",
      label: "Recover",
      detail: "Refresh this stream and resume from saved progress",
      shortcut: "r",
      tone: "warning",
    });
  }
  if (state.fallbackAvailable) {
    actions.push({
      id: "fallback",
      label: "Fallback",
      detail: state.fallbackProviderName
        ? `Try ${state.fallbackProviderName}`
        : "Try another compatible provider",
      shortcut: "f",
      tone: "warning",
    });
  }
  if (stalled || didNotStart || noSource) {
    actions.push({
      id: "sources",
      label: "Sources",
      detail: "Choose a different source or stream variant",
      shortcut: "s",
    });
  }
  actions.push({
    id: "diagnostics",
    label: "Diagnostics",
    detail: "Open trace and playback evidence",
    shortcut: "d",
    tone: "muted",
  });

  const title = stalled
    ? "Stream stalled"
    : didNotStart
      ? "Playback did not start"
      : noSource
        ? "No playable source"
        : "Provider degraded";

  return {
    state: {
      kind: stalled || didNotStart || noSource ? "error" : "info",
      title,
      detail:
        stalled || didNotStart || noSource
          ? "Progress is preserved. Kunai will not mark this episode watched until playback recovers."
          : "Kunai is trying a safer path. You can fallback or inspect diagnostics.",
      actions,
    },
    actions,
  };
}
```

- [ ] **Step 4: Run recovery view-model tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts
```

Expected: pass.

---

## Task 6: Wire Recovery Into `LoadingShell`

**Files:**

- Modify: `apps/cli/src/app-shell/loading-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts`
- Test: `apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts`

- [ ] **Step 1: Extend recovery tests with action order expectations**

Update `apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts` with:

```ts
test("no source available keeps diagnostics but does not offer next", () => {
  const model = buildPlaybackRecoveryViewModel(
    baseState({
      operation: "resolving",
      latestIssue: "No source available",
      hasNextEpisode: true,
    }),
  );
  expect(model?.state.title).toBe("No playable source");
  expect(model?.actions.map((action) => action.id)).toEqual(["recover", "sources", "diagnostics"]);
  expect(model?.actions.some((action) => action.id === "next")).toBe(false);
});
```

- [ ] **Step 2: Run recovery tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts
```

Expected: pass after Task 5.

- [ ] **Step 3: Import and compute recovery view model in `LoadingShell`**

In `apps/cli/src/app-shell/loading-shell.tsx`, add imports:

```ts
import { buildPlaybackRecoveryViewModel } from "./playback-recovery-view-model";
import { ActionList } from "./primitives/ActionList";
import { StateBlock } from "./primitives/StateBlock";
```

Near existing derived values after `const loadingIssue = normalizeLoadingIssue(state.latestIssue);`, add:

```ts
const recoveryView = buildPlaybackRecoveryViewModel(state);
```

- [ ] **Step 4: Render recovery block above low-level issue warning**

In the non-playing loading body, before the current issue warning block, render:

```tsx
{
  recoveryView ? (
    <Box marginTop={1}>
      <StateBlock model={recoveryView.state} width={infoWidth} />
    </Box>
  ) : null;
}
```

Then keep the existing `⚠ {loadingIssue}` warning only when `!recoveryView`.

Expected shape:

```tsx
{
  recoveryView ? (
    <Box marginTop={1}>
      <StateBlock model={recoveryView.state} width={infoWidth} />
    </Box>
  ) : disclosure.showIssue && loadingIssue ? (
    <Box marginTop={1}>
      <Text color={palette.accentDeep}>⚠ {loadingIssue}</Text>
    </Box>
  ) : null;
}
```

- [ ] **Step 5: Promote footer actions for recovery**

Update footer action building so recovery view states expose `recover`, `fallback`, `sources`, and `diagnostics`, while still preserving `[/] commands`.

Add a helper inside `loading-shell.tsx`:

```ts
function recoveryFooterActions(
  recoveryView: ReturnType<typeof buildPlaybackRecoveryViewModel>,
): readonly FooterAction[] {
  if (!recoveryView) return [];
  return [
    ...recoveryView.actions.map(
      (action): FooterAction => ({
        key: action.shortcut ?? action.id.slice(0, 1),
        label: action.label.toLowerCase(),
        action:
          action.id === "fallback"
            ? "fallback"
            : action.id === "sources"
              ? "streams"
              : action.id === "diagnostics"
                ? "diagnostics"
                : "recover",
        primary: action.id === "recover",
      }),
    ),
    { key: "/", label: "commands", action: "command-mode" },
  ];
}
```

Then prefer those actions when `recoveryView` exists:

```ts
const footerActions: readonly FooterAction[] = recoveryView
  ? selectFooterActions(recoveryFooterActions(recoveryView), "detailed", terminalColumns)
  : state.operation === "playing"
    ? selectFooterActions(playingFooterActions, "minimal")
    : [
        { key: "/", label: "commands", action: "command-mode" },
        // existing fallback/settings/history/diagnostics/help actions
      ];
```

- [ ] **Step 6: Route recovery action rows**

In `onResolve`, make sure mapped actions route to existing handlers:

```ts
onResolve={(action) => {
  if (action === "memory") {
    setMemoryPanelVisible((visible) => !visible);
    return;
  }
  if (action === "recover" && onRecover) {
    onRecover();
    return;
  }
  if (action === "fallback" && onFallback) {
    onFallback();
    return;
  }
  if (action === "streams" && onPickStreams) {
    onPickStreams();
    return;
  }
  state.onCommandAction?.(action);
}}
```

- [ ] **Step 7: Remove unused imports**

If `ActionList` is not used directly because `StateBlock` owns it, remove the import.

- [ ] **Step 8: Run targeted tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts
```

Expected: pass.

---

## Task 7: Wire `ContextCard` Into Playing/Post-Playback Context

**Files:**

- Modify: `apps/cli/src/app-shell/loading-shell.tsx`
- Modify: `apps/cli/src/app-shell/post-play-shell.tsx`
- Test: `apps/cli/test/unit/app-shell/context-card.test.ts`

- [ ] **Step 1: Add model builder tests for previous/next labels**

Extend `apps/cli/test/unit/app-shell/context-card.test.ts`:

```ts
import { buildPlaybackContextCards } from "@/app-shell/primitives/ContextCard";

test("builds next and previous context cards without huge labels", () => {
  const cards = buildPlaybackContextCards({
    nextEpisodeLabel: "E32 · Challengers of Science · 24m",
    previousEpisodeLabel: "E30 · Stone to Space · watched",
    hasNextEpisode: true,
    hasPreviousEpisode: true,
  });

  expect(cards.map((card) => card.kind)).toEqual(["next", "previous"]);
  expect(cards[0]?.stateTone).toBe("success");
  expect(cards[1]?.stateLabel).toBe("watched");
});
```

- [ ] **Step 2: Implement `buildPlaybackContextCards`**

Add to `apps/cli/src/app-shell/primitives/ContextCard.tsx`:

```ts
export function buildPlaybackContextCards(input: {
  readonly nextEpisodeLabel?: string;
  readonly previousEpisodeLabel?: string;
  readonly hasNextEpisode?: boolean;
  readonly hasPreviousEpisode?: boolean;
}): readonly ContextCardModel[] {
  const cards: ContextCardModel[] = [];
  if (input.hasNextEpisode && input.nextEpisodeLabel) {
    cards.push({
      kind: "next",
      title: input.nextEpisodeLabel,
      subtitle: "next",
      thumbnailState: "none",
      stateLabel: "playable",
      stateTone: "success",
    });
  }
  if (input.hasPreviousEpisode && input.previousEpisodeLabel) {
    cards.push({
      kind: "previous",
      title: input.previousEpisodeLabel,
      subtitle: "previous",
      thumbnailState: "none",
      stateLabel: "watched",
      stateTone: "success",
    });
  }
  return cards;
}
```

- [ ] **Step 3: Run context card tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/context-card.test.ts
```

Expected: pass.

- [ ] **Step 4: Use `ContextCard` in active playback**

In `apps/cli/src/app-shell/loading-shell.tsx`, import:

```ts
import { buildPlaybackContextCards, ContextCard } from "./primitives/ContextCard";
```

In the playing branch, derive:

```ts
const playbackContextCards = buildPlaybackContextCards({
  nextEpisodeLabel: state.nextEpisodeLabel,
  previousEpisodeLabel: state.previousEpisodeLabel,
  hasNextEpisode: state.hasNextEpisode,
  hasPreviousEpisode: state.hasPreviousEpisode,
});
```

Render the cards in the right/secondary area only when width allows. The exact position should replace loose `next` / `previous` text, not add another block of clutter:

```tsx
{
  terminalColumns >= 132 && playbackContextCards.length > 0 ? (
    <Box marginTop={1} flexDirection="column">
      {playbackContextCards.slice(0, 2).map((card, index) => (
        <Box key={`${card.kind}-${card.title}`} marginTop={index === 0 ? 0 : 1}>
          <ContextCard model={card} width={34} />
        </Box>
      ))}
    </Box>
  ) : null;
}
```

- [ ] **Step 5: Use `ContextCard` in post-playback only for next context**

In `apps/cli/src/app-shell/post-play-shell.tsx`, import:

```ts
import { ContextCard } from "./primitives/ContextCard";
```

Replace the current loose `▶ up next` body block with:

```tsx
<ContextCard
  selected
  width={Math.min(42, Math.max(28, viewport.columns - 20))}
  model={{
    kind: "next",
    title: nextEpisodeLabel ?? "Next episode",
    subtitle: "next episode",
    thumbnailState: "none",
    stateLabel: "playable",
    stateTone: "success",
    actionLabel: "enter",
  }}
/>
```

Keep the existing conditions. Do not redesign recommendations in this task.

- [ ] **Step 6: Run targeted tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/context-card.test.ts apps/cli/test/unit/app-shell/loading-shell.test.ts
```

Expected: pass.

---

## Task 8: Footer Recovery Collapse Check

**Files:**

- Modify: `apps/cli/src/app-shell/shell-primitives.tsx`
- Test: `apps/cli/test/unit/app-shell/shell-primitives.test.ts`

- [ ] **Step 1: Add footer collapse test for recovery surfaces**

Append to `apps/cli/test/unit/app-shell/shell-primitives.test.ts`:

```ts
test("recovery footer keeps commands while prioritizing recover and fallback", () => {
  const actions: readonly FooterAction[] = [
    { key: "r", label: "recover", action: "recover", primary: true },
    { key: "f", label: "fallback", action: "fallback" },
    { key: "s", label: "sources", action: "streams" },
    { key: "d", label: "diagnostics", action: "diagnostics" },
    { key: "/", label: "commands", action: "command-mode" },
  ];

  const visible = selectFooterActions(actions, "detailed", 80);

  expect(visible.at(0)?.action).toBe("recover");
  expect(visible.some((action) => action.action === "command-mode")).toBe(true);
  expect(visible.length).toBeLessThanOrEqual(4);
});
```

- [ ] **Step 2: Run the footer test**

Run:

```sh
bun test apps/cli/test/unit/app-shell/shell-primitives.test.ts
```

Expected: if it fails because command mode is not preserved at compact width, adjust the detailed footer selection so command mode is appended after width capping.

- [ ] **Step 3: Make the minimal footer adjustment if needed**

If the test fails because `command-mode` is not preserved, change the detailed-mode branch in `apps/cli/src/app-shell/shell-primitives.tsx` so command mode is appended after width capping and included in the returned list even when width is tight.

The expected shape is:

```ts
const widthLimit = terminalWidth < 92 ? 2 : terminalWidth < 132 ? 3 : DETAILED_FOOTER_VISIBLE_LIMIT;
const primaryLimit = Math.min(hardLimit, Math.max(1, widthLimit));

const capped = nonCommandActions.slice(0, primaryLimit);
return commandAction ? [...capped, commandAction] : capped;
```

If the code already has this shape and the test still fails, inspect action ordering before changing behavior. The key requirement is: `recover` and `[/] commands` survive compact widths.

---

## Task 9: Documentation Update

**Files:**

- Modify: `.design/cli/03-component-boundaries.md`
- Modify: `.design/cli/missing-surfaces-implementation-map.md`
- Modify: `.plans/sakura-rollout.md`

- [ ] **Step 1: Add `ContextCard` to component boundaries**

Add after `PreviewRail` in `.design/cli/03-component-boundaries.md`:

```md
### ContextCard

Owns:

- compact next/previous/now/related rows
- fixed height
- thumbnail or initials fallback
- one-line title and one-line metadata clamp
- small state glyph

Rules:

- Do not render huge `next` / `prev` labels.
- Do not let long titles increase card height.
- Hide previous context before next context on narrow terminals.
- Hide thumbnail before hiding the card.
```

- [ ] **Step 2: Mark this plan as the active S2 foundation path**

Add a short link in `.plans/sakura-rollout.md` under S2:

```md
Implementation plan: `.plans/sakura-shared-primitives-recovery-plan.md`
```

- [ ] **Step 3: Keep missing-surfaces map aligned**

If implementation changes any model name, update `.design/cli/missing-surfaces-implementation-map.md` to match the final exported type names.

---

## Task 10: Verification

**Files:**

- All files touched by Tasks 1-9.

- [ ] **Step 1: Run targeted unit tests**

Run:

```sh
bun test apps/cli/test/unit/app-shell/context-card.test.ts apps/cli/test/unit/app-shell/action-list.test.ts apps/cli/test/unit/app-shell/state-block.test.ts apps/cli/test/unit/app-shell/preview-rail.test.ts apps/cli/test/unit/app-shell/playback-recovery-view-model.test.ts apps/cli/test/unit/app-shell/shell-primitives.test.ts apps/cli/test/unit/app-shell/loading-shell.test.ts apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run typecheck**

Run:

```sh
bun run typecheck
```

Expected: pass.

- [ ] **Step 3: Run lint if this is the only active agent**

Run:

```sh
bun run lint
```

Expected: pass.

If another agent is simultaneously editing related files, do not run broad formatting until coordination is clear.

- [ ] **Step 4: Manual visual check**

Run:

```sh
bun run dev
```

Check:

- Active playback with next/previous context no longer shows giant labels.
- Stream stalled surface promotes recover/fallback/sources/diagnostics.
- Playback did not start does not mark watched and does not promote next.
- No source/quality unavailable shows a recovery state and diagnostics.
- Footer stays to four primary actions plus commands.
- Narrow terminal hides rail/context before damaging main text.

Do not hit live providers repeatedly. Use local deterministic paths where possible; use one manual smoke only when the deterministic shell work is green.

## Completion Report Template

When done, report:

```md
Implemented Sakura shared primitives + S2 recovery foundation.

Files touched:

- ...

Key behavior decisions:

- ...

Verification:

- `bun test ...` PASS
- `bun run typecheck` PASS
- `bun run lint` PASS or skipped with reason

Remaining:

- Search/details
- Tracks/capability rows
- Scoped command palette
- Calendar/return loop
- Portability fallback
```
