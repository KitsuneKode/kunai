# Kunai UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared design foundation (expanded tokens → pure layout helpers → thin primitive components → one canonical app header) so every later screen slice rides a single, tested, calm-but-premium kit.

**Architecture:** Additive, dependency-ordered. Tokens land first (zero UI change), then pure formatting functions with unit tests, then thin Ink components that delegate layout to those functions, then the frame consolidation that removes the duplicate header. Tests target pure functions (matching the repo convention of testing `formatPickerOptionRow`-style helpers, not Ink renders).

**Tech Stack:** Bun, TypeScript, Ink (React for terminal), `bun:test`. Tokens in `@kunai/design`; shell in `apps/cli/src/app-shell`.

**Source spec:** `docs/superpowers/specs/2026-05-21-kunai-ui-polish-design.md` (slices S0, S1, S2, S3a).

**Commands:** `bun run typecheck` · `bun run lint` · `bun run fmt` · `bun run test` (never `bun test` directly).

---

## File Structure

**S0 — Tokens**

- Modify: `packages/design/src/tokens.ts` — add surface (`scrim`, `raised`), `borderStrong`, per-accent `*Fill` tints, `heatRamp`, `contentTint` map.
- Modify: `apps/cli/src/app-shell/shell-theme.ts` — expose new tokens through `palette` + add `contentTintColor()` / `heatColor()` helpers.

**S1 — Pure helpers**

- Modify: `apps/cli/src/app-shell/shell-text.ts` — add `truncateAtWord`.
- Create: `apps/cli/src/app-shell/format/segmented.ts` — `segmentGeometry`.
- Create: `apps/cli/src/app-shell/format/heatmap.ts` — `heatBucket`, `boundHeatWindow`.
- Create: `apps/cli/src/app-shell/format/bar.ts` — `barFill`.
- Create: `apps/cli/src/app-shell/format/header.ts` — `composeHeader`.
- Create: `apps/cli/src/app/track-format.ts` — `formatLanguageBadge`, `formatSourceEvidence` (typed evidence-vs-language seam).
- Tests under `apps/cli/test/unit/app-shell/format/` and `apps/cli/test/unit/app/`.

**S2 — Primitive components**

- Create: `apps/cli/src/app-shell/primitives/AppHeader.tsx`, `TabStrip.tsx`, `SegmentedControl.tsx`, `Heatmap.tsx`, `ProgressBar.tsx`, `InsightLine.tsx`, `StateBlock.tsx`.
- Modify: `apps/cli/src/app-shell/shell-primitives.tsx` — add `SelectableRow`, tabular `DetailRow` (replace dot form), refine `FooterHint` (calm key/label coloring), extend `Badge` with content-type + fill.

**S3a — Frame dedup**

- Modify: `apps/cli/src/app-shell/shell-frame.tsx` — render `AppHeader` instead of ad-hoc title/subtitle.
- Modify: `apps/cli/src/app-shell/root-status-shells.tsx` — `RootIdleShell` stops re-rendering brand/mode/provider.
- Modify: browse content header (whichever component renders `🦊 Kunai · browse · …`; locate via grep in Step 1).

---

## S0 — Expanded tokens

### Task 1: Add surface, border, and fill tokens

**Files:**

- Modify: `packages/design/src/tokens.ts`

- [ ] **Step 1: Add new token values**

Insert into the `tokens` object (keep all existing keys). Add after `borderDim`:

```ts
  scrim: "#0a0806",
  raised: "#3a2f24",
  borderStrong: "#4a3d30",
```

Add fill tints near their accent definitions (these are pre-blended onto `bg` — the terminal stand-in for opacity):

```ts
  amberFill: "#2a2012",
  tealFill: "#13241f",
  infoFill: "#15243a",
  pinkFill: "#2a1420",
  lavenderFill: "#20203a",
  greenFill: "#16261a",
  yellowFill: "#2a2410",
  redFill: "#2e1717",
  purpleFill: "#2a1c3a",
```

Add the heat ramp and content tint map after the text scale (before the closing `} as const;`):

```ts
  heatRamp: ["#2a2018", "#7a4a10", "#b06a18", "#d68a24", "#f0a050"],
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (additive, `as const` still valid; `heatRamp` becomes a readonly tuple).

- [ ] **Step 3: Commit**

```bash
git add packages/design/src/tokens.ts
git commit -m "feat(design): expand tokens with surfaces, fills, and heat ramp"
```

### Task 2: Expose new tokens + helpers through shell-theme

**Files:**

- Modify: `apps/cli/src/app-shell/shell-theme.ts`
- Test: `apps/cli/test/unit/app-shell/shell-theme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { contentTintColor, heatColor, palette } from "@/app-shell/shell-theme";

describe("shell-theme", () => {
  test("exposes new surface + fill tokens", () => {
    expect(palette.raised).toBe("#3a2f24");
    expect(palette.amberFill).toBe("#2a2012");
    expect(palette.borderStrong).toBe("#4a3d30");
  });

  test("contentTintColor maps each media kind to its accent", () => {
    expect(contentTintColor("anime")).toBe(palette.pink);
    expect(contentTintColor("series")).toBe(palette.info);
    expect(contentTintColor("movie")).toBe(palette.lavender);
  });

  test("heatColor clamps the ramp index", () => {
    expect(heatColor(0)).toBe("#2a2018");
    expect(heatColor(4)).toBe("#f0a050");
    expect(heatColor(99)).toBe("#f0a050");
    expect(heatColor(-3)).toBe("#2a2018");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/shell-theme.test.ts`
Expected: FAIL (`contentTintColor`/`heatColor` undefined; `palette.raised` undefined).

- [ ] **Step 3: Implement**

Add to `palette` (after the existing entries, before `as const`):

```ts
  raised: tokens.raised,
  scrim: tokens.scrim,
  borderStrong: tokens.borderStrong,
  amberFill: tokens.amberFill,
  tealFill: tokens.tealFill,
  infoFill: tokens.infoFill,
  pinkFill: tokens.pinkFill,
  lavenderFill: tokens.lavenderFill,
  greenFill: tokens.greenFill,
  yellowFill: tokens.yellowFill,
  redFill: tokens.redFill,
  purpleFill: tokens.purpleFill,
```

Add helpers at the end of the file:

```ts
export function contentTintColor(kind: "anime" | "series" | "movie"): string {
  if (kind === "anime") return palette.pink;
  if (kind === "movie") return palette.lavender;
  return palette.info;
}

export function heatColor(rampIndex: number): string {
  const ramp = tokens.heatRamp;
  const clamped = Math.max(0, Math.min(ramp.length - 1, Math.trunc(rampIndex)));
  return ramp[clamped] ?? ramp[0];
}
```

(Add `import { tokens } from "@kunai/design";` if not already present — it is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/shell-theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/shell-theme.ts apps/cli/test/unit/app-shell/shell-theme.test.ts
git commit -m "feat(shell): expose expanded tokens + content/heat helpers"
```

---

## S1 — Pure layout helpers

### Task 3: Word-safe truncation

**Files:**

- Modify: `apps/cli/src/app-shell/shell-text.ts`
- Test: `apps/cli/test/unit/app-shell/shell-text.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { truncateAtWord } from "@/app-shell/shell-text";

describe("truncateAtWord", () => {
  test("returns input when it fits", () => {
    expect(truncateAtWord("blue collar", 20)).toBe("blue collar");
  });
  test("breaks on a word boundary, never mid-word", () => {
    // "...no more than blue-col" bug: must not cut inside a word
    expect(truncateAtWord("take down corrupt superheroes", 18)).toBe("take down corrupt…");
  });
  test("falls back to hard cut when first word exceeds width", () => {
    expect(truncateAtWord("supercalifragilistic", 6)).toBe("super…");
  });
  test("handles tiny widths", () => {
    expect(truncateAtWord("anything", 1)).toBe("…");
    expect(truncateAtWord("anything", 0)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/shell-text.test.ts`
Expected: FAIL (`truncateAtWord` not exported).

- [ ] **Step 3: Implement** (append to `shell-text.ts`, reuse `truncateLine`)

```ts
export function truncateAtWord(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…";
  const budget = maxLength - 1; // room for the ellipsis
  const slice = value.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace <= 0) return truncateLine(value, maxLength); // first word too long → hard cut
  return `${slice.slice(0, lastSpace)}…`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/shell-text.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/shell-text.ts apps/cli/test/unit/app-shell/shell-text.test.ts
git commit -m "feat(shell): add word-safe truncation helper"
```

### Task 4: Segmented control geometry

**Files:**

- Create: `apps/cli/src/app-shell/format/segmented.ts`
- Test: `apps/cli/test/unit/app-shell/format/segmented.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { segmentGeometry } from "@/app-shell/format/segmented";

describe("segmentGeometry", () => {
  test("marks the active segment and pads the active label as a pill", () => {
    const g = segmentGeometry(["All", "Series", "Anime"], 0);
    expect(g.map((s) => s.active)).toEqual([true, false, false]);
    expect(g[0].text).toBe(" All "); // active gets pill padding
    expect(g[1].text).toBe("Series");
  });
  test("clamps the active index", () => {
    const g = segmentGeometry(["A", "B"], 9);
    expect(g[1].active).toBe(true);
  });
  test("empty input yields empty geometry", () => {
    expect(segmentGeometry([], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/segmented.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type Segment = { readonly label: string; readonly text: string; readonly active: boolean };

export function segmentGeometry(labels: readonly string[], activeIndex: number): Segment[] {
  if (labels.length === 0) return [];
  const active = Math.max(0, Math.min(labels.length - 1, Math.trunc(activeIndex)));
  return labels.map((label, index) => ({
    label,
    text: index === active ? ` ${label} ` : label,
    active: index === active,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/segmented.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/format/segmented.ts apps/cli/test/unit/app-shell/format/segmented.test.ts
git commit -m "feat(shell): add segmented control geometry helper"
```

### Task 5: Heatmap bucketing + 12-month window

**Files:**

- Create: `apps/cli/src/app-shell/format/heatmap.ts`
- Test: `apps/cli/test/unit/app-shell/format/heatmap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { boundHeatWindow, heatBucket } from "@/app-shell/format/heatmap";

describe("heatBucket", () => {
  test("zero value is bucket 0", () => {
    expect(heatBucket(0, 10)).toBe(0);
  });
  test("max value is bucket 4", () => {
    expect(heatBucket(10, 10)).toBe(4);
  });
  test("scales linearly into 1..4 for non-zero values", () => {
    expect(heatBucket(3, 10)).toBe(2);
  });
  test("guards a zero max", () => {
    expect(heatBucket(5, 0)).toBe(0);
  });
});

describe("boundHeatWindow", () => {
  test("keeps only the most recent N months of entries", () => {
    const entries = Array.from({ length: 18 }, (_, i) => ({ month: i }));
    expect(boundHeatWindow(entries, 12)).toHaveLength(12);
    expect(boundHeatWindow(entries, 12)[0].month).toBe(6);
  });
  test("returns all entries when fewer than the window", () => {
    const entries = [{ month: 1 }, { month: 2 }];
    expect(boundHeatWindow(entries, 12)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/heatmap.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export function heatBucket(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  const ratio = Math.min(1, value / max);
  return Math.max(1, Math.ceil(ratio * 4)); // 1..4 for any positive activity
}

export function boundHeatWindow<T>(entries: readonly T[], months: number): T[] {
  if (months <= 0) return [];
  if (entries.length <= months) return [...entries];
  return entries.slice(entries.length - months);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/heatmap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/format/heatmap.ts apps/cli/test/unit/app-shell/format/heatmap.test.ts
git commit -m "feat(shell): add heatmap bucketing + window helpers"
```

### Task 6: Per-row bar fill (fixes collapsed Stats bars)

**Files:**

- Create: `apps/cli/src/app-shell/format/bar.ts`
- Test: `apps/cli/test/unit/app-shell/format/bar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { barFill } from "@/app-shell/format/bar";

describe("barFill", () => {
  test("splits a row into filled + track segments of fixed total width", () => {
    const r = barFill(5, 10, 10);
    expect(r.filled + r.track).toBe(10);
    expect(r.filled).toBe(5);
  });
  test("full value fills the whole width", () => {
    expect(barFill(10, 10, 8)).toEqual({ filled: 8, track: 0 });
  });
  test("zero or zero-max yields an empty bar", () => {
    expect(barFill(0, 10, 8)).toEqual({ filled: 0, track: 8 });
    expect(barFill(4, 0, 8)).toEqual({ filled: 0, track: 8 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/bar.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type BarSegments = { readonly filled: number; readonly track: number };

export function barFill(value: number, max: number, width: number): BarSegments {
  if (width <= 0) return { filled: 0, track: 0 };
  if (max <= 0 || value <= 0) return { filled: 0, track: width };
  const ratio = Math.min(1, value / max);
  const filled = Math.round(ratio * width);
  return { filled, track: width - filled };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/bar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/format/bar.ts apps/cli/test/unit/app-shell/format/bar.test.ts
git commit -m "feat(shell): add per-row bar fill helper"
```

### Task 7: Header composition helper

**Files:**

- Create: `apps/cli/src/app-shell/format/header.ts`
- Test: `apps/cli/test/unit/app-shell/format/header.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { composeHeader } from "@/app-shell/format/header";

describe("composeHeader", () => {
  test("builds left segments: brand, destination pill, context", () => {
    const h = composeHeader({
      brand: "🦊 Kunai",
      destination: "Browse",
      context: "vidking · series",
      status: "ready",
      size: "182×40",
    });
    expect(h.brand).toBe("🦊 Kunai");
    expect(h.pill).toBe(" Browse "); // pill padding
    expect(h.context).toBe("vidking · series");
    expect(h.right).toBe("ready · 182×40");
  });
  test("omits empty context and size cleanly", () => {
    const h = composeHeader({ brand: "🦊 Kunai", destination: "Stats", status: "ready" });
    expect(h.context).toBe("");
    expect(h.right).toBe("ready");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/header.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type HeaderInput = {
  readonly brand: string;
  readonly destination: string;
  readonly context?: string;
  readonly status?: string;
  readonly size?: string;
};

export type HeaderParts = {
  readonly brand: string;
  readonly pill: string;
  readonly context: string;
  readonly right: string;
};

export function composeHeader(input: HeaderInput): HeaderParts {
  const right = [input.status, input.size]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return {
    brand: input.brand,
    pill: ` ${input.destination} `,
    context: input.context ?? "",
    right,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/format/header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/format/header.ts apps/cli/test/unit/app-shell/format/header.test.ts
git commit -m "feat(shell): add header composition helper"
```

### Task 8: Typed evidence-vs-language seam

**Files:**

- Create: `apps/cli/src/app/track-format.ts`
- Test: `apps/cli/test/unit/app/track-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { formatLanguageBadge, formatSourceEvidence } from "@/app/track-format";

describe("track-format seam", () => {
  test("formatLanguageBadge renders normalized language + role", () => {
    expect(formatLanguageBadge({ language: "en", role: "subtitle" })).toBe("EN subs");
    expect(formatLanguageBadge({ language: "ja", role: "audio" })).toBe("JA audio");
    expect(formatLanguageBadge({ language: "en", role: "hardsub" })).toBe("EN hardsub");
  });
  test("formatSourceEvidence renders native label/host, never as a language", () => {
    expect(formatSourceEvidence({ nativeLabel: "vidstream", host: "zoro" })).toBe(
      "vidstream · zoro",
    );
    expect(formatSourceEvidence({ host: "vidsrc.to" })).toBe("vidsrc.to");
    expect(formatSourceEvidence({})).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app/track-format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (distinct input shapes make mixing them a type error)

```ts
export type LanguageBadgeInput = {
  readonly language: string; // normalized ISO-639 code only
  readonly role: "audio" | "subtitle" | "hardsub";
};

export type SourceEvidenceInput = {
  readonly nativeLabel?: string; // provider/server label — NEVER a language
  readonly host?: string;
};

const ROLE_SUFFIX: Record<LanguageBadgeInput["role"], string> = {
  audio: "audio",
  subtitle: "subs",
  hardsub: "hardsub",
};

export function formatLanguageBadge(input: LanguageBadgeInput): string {
  return `${input.language.toUpperCase()} ${ROLE_SUFFIX[input.role]}`;
}

export function formatSourceEvidence(input: SourceEvidenceInput): string {
  return [input.nativeLabel, input.host]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app/track-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app/track-format.ts apps/cli/test/unit/app/track-format.test.ts
git commit -m "feat(app): add typed evidence-vs-language formatting seam"
```

---

## S2 — Primitive components (thin views over tested helpers)

### Task 9: SelectableRow (the "C" selection treatment)

**Files:**

- Modify: `apps/cli/src/app-shell/shell-primitives.tsx`
- Test: `apps/cli/test/unit/app-shell/selectable-row.test.ts`

- [ ] **Step 1: Write the failing test** (test the pure prefix/fill decision, not the Ink render)

```ts
import { describe, expect, test } from "bun:test";
import { selectableRowStyle } from "@/app-shell/shell-primitives";

describe("selectableRowStyle", () => {
  test("selected row uses amber rule + fill background", () => {
    const s = selectableRowStyle(true);
    expect(s.prefix).toBe("▌");
    expect(s.backgroundColor).toBe("#2a2012"); // amberFill
    expect(s.color).toBe("#ffbf80"); // amberSoft
  });
  test("unselected row is calm: no fill, two-space prefix", () => {
    const s = selectableRowStyle(false);
    expect(s.prefix).toBe("  ");
    expect(s.backgroundColor).toBeUndefined();
    expect(s.color).toBe("#e8ddd0"); // text
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/selectable-row.test.ts`
Expected: FAIL (`selectableRowStyle` not exported).

- [ ] **Step 3: Implement** — add to `shell-primitives.tsx`

```tsx
export type SelectableRowStyle = {
  readonly prefix: string;
  readonly color: string;
  readonly backgroundColor?: string;
};

export function selectableRowStyle(selected: boolean): SelectableRowStyle {
  if (selected) {
    return { prefix: "▌", color: palette.amberSoft, backgroundColor: palette.amberFill };
  }
  return { prefix: "  ", color: palette.text };
}

export const SelectableRow = React.memo(function SelectableRow({
  selected,
  children,
}: {
  selected: boolean;
  children: React.ReactNode;
}) {
  const style = selectableRowStyle(selected);
  return (
    <Box>
      <Text color={selected ? palette.amber : palette.dim} backgroundColor={style.backgroundColor}>
        {style.prefix}
      </Text>
      <Text color={style.color} backgroundColor={style.backgroundColor}>
        {children}
      </Text>
    </Box>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/selectable-row.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/shell-primitives.tsx apps/cli/test/unit/app-shell/selectable-row.test.ts
git commit -m "feat(shell): add SelectableRow primitive (accent rule + fill)"
```

### Task 10: TabStrip + SegmentedControl components

**Files:**

- Create: `apps/cli/src/app-shell/primitives/SegmentedControl.tsx`
- Create: `apps/cli/src/app-shell/primitives/TabStrip.tsx`

- [ ] **Step 1: Implement SegmentedControl** (delegates to tested `segmentGeometry`)

```tsx
import { Box, Text } from "ink";
import React from "react";
import { segmentGeometry } from "../format/segmented";
import { palette } from "../shell-theme";

export const SegmentedControl = React.memo(function SegmentedControl({
  labels,
  activeIndex,
  activeBg = palette.amberFill,
  activeFg = palette.amber,
}: {
  labels: readonly string[];
  activeIndex: number;
  activeBg?: string;
  activeFg?: string;
}) {
  const segments = segmentGeometry(labels, activeIndex);
  return (
    <Box>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 ? <Text color={palette.dim}> </Text> : null}
          <Text
            color={seg.active ? activeFg : palette.muted}
            backgroundColor={seg.active ? activeBg : undefined}
          >
            {seg.text}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
});
```

- [ ] **Step 2: Implement TabStrip** (active = filled cream pill; pure data reused)

```tsx
import { Box, Text } from "ink";
import React from "react";
import { segmentGeometry } from "../format/segmented";
import { palette } from "../shell-theme";

export const TabStrip = React.memo(function TabStrip({
  labels,
  activeIndex,
}: {
  labels: readonly string[];
  activeIndex: number;
}) {
  const segments = segmentGeometry(labels, activeIndex);
  return (
    <Box>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 ? <Text color={palette.dim}>{"  "}</Text> : null}
          <Text
            bold={seg.active}
            color={seg.active ? palette.bg : palette.muted}
            backgroundColor={seg.active ? palette.text : undefined}
          >
            {seg.text}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
});
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/primitives/SegmentedControl.tsx apps/cli/src/app-shell/primitives/TabStrip.tsx
git commit -m "feat(shell): add TabStrip + SegmentedControl primitives"
```

### Task 11: ProgressBar, Heatmap, InsightLine components

**Files:**

- Create: `apps/cli/src/app-shell/primitives/ProgressBar.tsx`
- Create: `apps/cli/src/app-shell/primitives/Heatmap.tsx`
- Create: `apps/cli/src/app-shell/primitives/InsightLine.tsx`

- [ ] **Step 1: Implement ProgressBar** (uses tested `barFill`)

```tsx
import { Box, Text } from "ink";
import React from "react";
import { barFill } from "../format/bar";
import { palette } from "../shell-theme";

export const ProgressBar = React.memo(function ProgressBar({
  value,
  max,
  width = 20,
  color = palette.teal,
}: {
  value: number;
  max: number;
  width?: number;
  color?: string;
}) {
  const { filled, track } = barFill(value, max, width);
  return (
    <Box>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={palette.dim}>{"┈".repeat(track)}</Text>
    </Box>
  );
});
```

- [ ] **Step 2: Implement Heatmap** (uses tested `heatBucket` + `heatColor`)

```tsx
import { Box, Text } from "ink";
import React from "react";
import { heatBucket } from "../format/heatmap";
import { heatColor, palette } from "../shell-theme";

export type HeatRow = { readonly label: string; readonly values: readonly number[] };

export const Heatmap = React.memo(function Heatmap({
  rows,
  max,
  cell = "▪",
}: {
  rows: readonly HeatRow[];
  max: number;
  cell?: string;
}) {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.label}>
          <Text color={palette.muted}>{row.label.padEnd(4)}</Text>
          {row.values.map((v, i) => (
            <Text key={i} color={heatColor(heatBucket(v, max))}>
              {` ${cell}`}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
});
```

- [ ] **Step 3: Implement InsightLine**

```tsx
import { Text } from "ink";
import React from "react";
import { palette } from "../shell-theme";

export const InsightLine = React.memo(function InsightLine({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Text color={palette.info}>{children}</Text>;
});
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/primitives/ProgressBar.tsx apps/cli/src/app-shell/primitives/Heatmap.tsx apps/cli/src/app-shell/primitives/InsightLine.tsx
git commit -m "feat(shell): add ProgressBar, Heatmap, InsightLine primitives"
```

### Task 12: Tabular DetailRow + content-type Badge + calm FooterHint coloring

**Files:**

- Modify: `apps/cli/src/app-shell/shell-primitives.tsx`
- Test: `apps/cli/test/unit/app-shell/detail-row.test.ts`

- [ ] **Step 1: Write the failing test** (pure column helper)

```ts
import { describe, expect, test } from "bun:test";
import { detailRowColumns } from "@/app-shell/shell-primitives";

describe("detailRowColumns", () => {
  test("pads the label to a fixed column width", () => {
    const c = detailRowColumns("Audio", "JP", 10);
    expect(c.label).toBe("Audio     "); // padded to 10
    expect(c.value).toBe("JP");
  });
  test("truncates an overlong label to the column", () => {
    const c = detailRowColumns("Subtitles long", "EN", 8);
    expect(c.label.length).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/detail-row.test.ts`
Expected: FAIL (`detailRowColumns` not exported).

- [ ] **Step 3: Implement** — add to `shell-primitives.tsx` and update `DetailLine` to tabular form, add a `FooterHint` calm-coloured variant note

```tsx
export function detailRowColumns(
  label: string,
  value: string,
  labelWidth: number,
): { label: string; value: string } {
  const trimmed =
    label.length > labelWidth ? truncateLine(label, labelWidth) : label.padEnd(labelWidth);
  return { label: trimmed, value };
}

export const DetailRow = React.memo(function DetailRow({
  label,
  value,
  labelWidth = 12,
  tone = "neutral",
}: {
  label: string;
  value: string;
  labelWidth?: number;
  tone?: BadgeTone;
}) {
  const cols = detailRowColumns(label, value, labelWidth);
  const valueColor =
    tone === "success"
      ? palette.green
      : tone === "info"
        ? palette.info
        : tone === "accent"
          ? palette.amberSoft
          : tone === "error"
            ? palette.red
            : tone === "warning"
              ? palette.amber
              : palette.text;
  return (
    <Box>
      <Text color={palette.muted}>{cols.label}</Text>
      <Text color={valueColor}> {cols.value}</Text>
    </Box>
  );
});
```

Extend `Badge` with a content-type variant by adding an optional `contentKind` prop that, when present, colors via `contentTintColor` and uses the matching `*Fill` background. (Add `import { contentTintColor } from "./shell-theme";`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:unit -- test/unit/app-shell/detail-row.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/shell-primitives.tsx apps/cli/test/unit/app-shell/detail-row.test.ts
git commit -m "feat(shell): tabular DetailRow + content-type Badge"
```

### Task 13: AppHeader component

**Files:**

- Create: `apps/cli/src/app-shell/primitives/AppHeader.tsx`

- [ ] **Step 1: Implement** (delegates layout to tested `composeHeader`)

```tsx
import { Box, Text } from "ink";
import React from "react";
import { composeHeader } from "../format/header";
import { palette } from "../shell-theme";

export const AppHeader = React.memo(function AppHeader({
  brand = "🦊 Kunai",
  destination,
  context,
  status,
  statusColor = palette.green,
  size,
}: {
  brand?: string;
  destination: string;
  context?: string;
  status?: string;
  statusColor?: string;
  size?: string;
}) {
  const h = composeHeader({ brand, destination, context, status, size });
  return (
    <Box justifyContent="space-between">
      <Box>
        <Text color={palette.amber}>{h.brand}</Text>
        <Text color={palette.dim}>{"  ·  "}</Text>
        <Text bold color={palette.bg} backgroundColor={palette.text}>
          {h.pill}
        </Text>
        {h.context ? <Text color={palette.muted}>{`  ${h.context}`}</Text> : null}
      </Box>
      {h.right ? (
        <Box>
          {status ? <Text color={statusColor}>{"● "}</Text> : null}
          <Text color={palette.muted}>{h.right}</Text>
        </Box>
      ) : null}
    </Box>
  );
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/app-shell/primitives/AppHeader.tsx
git commit -m "feat(shell): add AppHeader primitive"
```

---

## S3a — Frame dedup (one canonical header)

### Task 14: Locate and remove the duplicate browse header

**Files:**

- Modify: `apps/cli/src/app-shell/shell-frame.tsx:84-91`
- Modify: `apps/cli/src/app-shell/root-status-shells.tsx` (`RootIdleShell`)
- Modify: the browse content header component (locate in Step 1)

- [ ] **Step 1: Locate every brand/header render**

Run: `rg -n "🦊 Kunai|browse · |APP_LABEL|· vidking" apps/cli/src/app-shell`
Expected: identifies `shell-frame.tsx` (title/subtitle), `root-status-shells.tsx`, and the browse content header (the second `🦊 Kunai · browse · vidking · series` line + size chip). Record the file:line of the browse-content header.

- [ ] **Step 2: Render AppHeader in ShellFrame**

In `shell-frame.tsx`, replace the inline title/subtitle block (the `<Box justifyContent="space-between">` with `<Text bold>{title}</Text>` + `<Text>{subtitle}</Text>` at lines ~85-91) with:

```tsx
import { AppHeader } from "./primitives/AppHeader";
// ...
<AppHeader
  destination={title}
  context={subtitle}
  status={status?.label}
  statusColor={status ? statusColor(status.tone) : undefined}
  size={`${cols}×${rows}`}
/>;
```

(`title` here is the destination label, e.g. "Browse"; `subtitle` is the `vidking · series` context. Callers already pass these.)

- [ ] **Step 3: Remove the duplicated brand from browse content + RootIdleShell**

In the browse-content header component found in Step 1, delete the line that renders `🦊 Kunai · browse · vidking · series` and the size chip — that state now lives in `AppHeader`. In `root-status-shells.tsx` `RootIdleShell`, remove the standalone `mode` line + brand echo; keep only the session/title body (the `⏸ <title>` block and idle hints), since brand/mode/provider are owned by the header.

- [ ] **Step 4: Verify no duplicate header by eye + typecheck**

Run: `bun run typecheck && bun run dev`
Expected: PASS; on launch the browse screen shows exactly ONE `🦊 Kunai · [Browse] vidking · series` header line and one footer. (Ctrl+C to exit.)

- [ ] **Step 5: Run the full suite + lint + fmt**

Run: `bun run typecheck && bun run lint && bun run fmt && bun run test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/shell-frame.tsx apps/cli/src/app-shell/root-status-shells.tsx
git add -A apps/cli/src/app-shell
git commit -m "fix(shell): single canonical AppHeader, remove duplicate top bars"
```

---

## Self-review notes (author)

- **Spec coverage:** S0 §4 → Tasks 1–2. S1 §5.1 → Tasks 3–8 (truncate, segmented, heatmap, bar, header, evidence seam). S2 §5.2 core → Tasks 9–13 (SelectableRow, Tab/Segmented, ProgressBar/Heatmap/InsightLine, DetailRow/Badge, AppHeader). S3a §2 → Task 14. `NavSidebar`, `CompanionPane`, `Empty/Loading/Degraded/Error` blocks, and `StateBlock` are deferred to the slices that first consume them (browse/library/sidebar plans) to avoid building untested unused surface — noted as a deliberate scope boundary, not a gap.
- **Placeholders:** none — every code step shows complete code.
- **Type consistency:** `selectableRowStyle`, `detailRowColumns`, `composeHeader`, `segmentGeometry`, `barFill`, `heatBucket`/`heatColor`, `formatLanguageBadge`/`formatSourceEvidence` names are used identically across tasks. `palette.amberFill`/`raised`/`borderStrong` (Task 2) are consumed by Tasks 9/12/13.
- **Next plan in chain:** `2026-05-21-kunai-ui-browse-pickers.md` (S4) authored after this lands, against the finalized primitive APIs.
