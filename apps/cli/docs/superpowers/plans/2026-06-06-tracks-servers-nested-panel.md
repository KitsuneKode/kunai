# Tracks / Servers Nested Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Tracks panel with a nested two-pane surface (sections left + options right, drill in/out without losing context) and add persisted "favorite servers" that pin to the top and are preferred during auto-selection.

**Architecture:** Pure, tested units do the thinking — a `normalizeSourceName` identity helper, a favorites-sort helper, a `tracksPanelNavReducer` (focus/section/option state, mirroring `browse-focus-zone.ts`), a layout helper for the subtitle grid + counts header, and a favorite-preference extension to `selectReadyStream`. The Ink `TracksPanelShell` becomes a thin renderer over reducer state; `root-overlay-shell.tsx` swaps its flat key handler for reducer-driven routing; `openTracksPanel` threads favorites + a persist callback.

**Tech Stack:** Bun, TypeScript, Ink/React, oxlint, `bun run test` (Bun test runner via turbo). Tests live under `apps/cli/test/unit/`.

Spec: `apps/cli/docs/superpowers/specs/2026-06-06-tracks-servers-nested-panel-design.md`.

---

## File Structure

**Create:**

- `apps/cli/src/domain/playback/source-name.ts` — `normalizeSourceName`, favorites sort helper. Pure, no deps.
- `apps/cli/src/app-shell/tracks-panel-nav.ts` — `tracksPanelNavReducer`, state type, initial-state factory. Pure.
- `apps/cli/src/app-shell/tracks-panel-layout.ts` — counts-header string + subtitle-grid row chunking. Pure.
- Test files mirroring each under `apps/cli/test/unit/...`.

**Modify:**

- `apps/cli/src/services/persistence/ConfigService.ts` — add `favoriteSources` field, default, toggle/read.
- `packages/providers/src/shared/startup-selection.ts` — favorite preference rank.
- `apps/cli/src/app-shell/tracks-panel-shell.tsx` — two-pane render + grid subs + narrow fallback.
- `apps/cli/src/app-shell/root-overlay-shell.tsx` — reducer-driven input routing for `tracks_panel`.
- `apps/cli/src/app-shell/workflows.ts` — `openTracksPanel` threads favorites + persist callback.
- The `tracks_panel` `OverlayState` definition (in the state/overlay types) — carry `favoriteSources`.
- The command registry + keybinding registry — drop `/tracks`, keep section deep-links, `s` → source.

---

## Phase 1 — Favorites foundation

### Task 1: `normalizeSourceName` identity helper

**Files:**

- Create: `apps/cli/src/domain/playback/source-name.ts`
- Test: `apps/cli/test/unit/domain/playback/source-name.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/domain/playback/source-name.test.ts
import { describe, expect, test } from "bun:test";
import { normalizeSourceName } from "@/domain/playback/source-name";

describe("normalizeSourceName", () => {
  test("lowercases, trims, strips spaces and punctuation", () => {
    expect(normalizeSourceName("VidLink")).toBe("vidlink");
    expect(normalizeSourceName("  Vid Link ")).toBe("vidlink");
    expect(normalizeSourceName("Vid-Link!")).toBe("vidlink");
    expect(normalizeSourceName("Neon 2")).toBe("neon2");
  });

  test("empty / whitespace-only collapses to empty string", () => {
    expect(normalizeSourceName("")).toBe("");
    expect(normalizeSourceName("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test 2>&1 | grep -A3 normalizeSourceName`
Expected: FAIL — module `source-name` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/cli/src/domain/playback/source-name.ts

/**
 * Stable identity for a source/server, used by favorites (persistence), the UI
 * (♥ + sort), and auto-select. Lowercase, strip everything that is not a letter
 * or digit so "VidLink", "Vid Link", "Vid-Link!" all map to "vidlink".
 */
export function normalizeSourceName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test 2>&1 | grep -A3 normalizeSourceName`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/source-name.ts apps/cli/test/unit/domain/playback/source-name.test.ts
git commit -m "feat(tracks): normalizeSourceName identity helper for favorites"
```

---

### Task 2: `favoriteSources` config field + ConfigService toggle

**Files:**

- Modify: `apps/cli/src/services/persistence/ConfigService.ts` (interface `KitsuneConfig`, the `DEFAULT_CONFIG`/defaults object, and the service class)
- Test: `apps/cli/test/unit/services/persistence/config-favorites.test.ts`

> Before editing, open `ConfigService.ts` and locate (a) the `KitsuneConfig` interface (starts line ~28), (b) the defaults object literal that initializes every field (search for `defaultMode:` assignment — the defaults live there), and (c) the load/normalize path that fills missing fields from older config files (search for where each field is read with `??`). Add the new field in all three, matching the surrounding style.

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/services/persistence/config-favorites.test.ts
import { describe, expect, test } from "bun:test";
import { toggleFavoriteSource } from "@/services/persistence/ConfigService";

describe("toggleFavoriteSource", () => {
  test("adds a normalized name when absent", () => {
    expect(toggleFavoriteSource([], "VidLink")).toEqual(["vidlink"]);
  });

  test("removes when present (by normalized identity)", () => {
    expect(toggleFavoriteSource(["vidlink"], "Vid Link")).toEqual([]);
  });

  test("is idempotent on identity, preserves other entries", () => {
    expect(toggleFavoriteSource(["neon", "vidlink"], "Cypher")).toEqual([
      "neon",
      "vidlink",
      "cypher",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test 2>&1 | grep -A3 toggleFavoriteSource`
Expected: FAIL — `toggleFavoriteSource` not exported.

- [ ] **Step 3: Implement**

Add to `KitsuneConfig` interface (near the other preference fields):

```ts
  /** Source/server names the user favorited, normalized via normalizeSourceName. Pin to top + preferred on auto-select. Default []. */
  favoriteSources: readonly string[];
```

Add to the defaults object (alongside `defaultMode`, etc.):

```ts
  favoriteSources: [],
```

In the load/normalize path that backfills older config files, add:

```ts
  favoriteSources: Array.isArray(raw.favoriteSources)
    ? raw.favoriteSources.filter((value: unknown): value is string => typeof value === "string")
    : [],
```

Add the pure exported helper (top-level, near other exports) — import the normalizer:

```ts
import { normalizeSourceName } from "@/domain/playback/source-name";

/** Toggle a source name in the favorites list by normalized identity. Returns a new array. */
export function toggleFavoriteSource(
  favorites: readonly string[],
  label: string,
): readonly string[] {
  const key = normalizeSourceName(label);
  if (!key) return favorites;
  return favorites.includes(key) ? favorites.filter((name) => name !== key) : [...favorites, key];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test 2>&1 | grep -A3 toggleFavoriteSource`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add apps/cli/src/services/persistence/ConfigService.ts apps/cli/test/unit/services/persistence/config-favorites.test.ts apps/cli/src/domain/playback/source-name.ts
git commit -m "feat(config): persisted favoriteSources + toggle helper"
```

---

### Task 3: favorites-first sort for source rows

**Files:**

- Modify: `apps/cli/src/domain/playback/source-name.ts` (add `sortByFavorites`)
- Test: `apps/cli/test/unit/domain/playback/source-name.test.ts` (extend)

- [ ] **Step 1: Add failing test**

```ts
// append to source-name.test.ts
import { sortByFavorites } from "@/domain/playback/source-name";

describe("sortByFavorites", () => {
  const rows = [{ label: "Neon" }, { label: "Cypher" }, { label: "Fade" }] as const;

  test("pins favorites first, preserves relative order (stable)", () => {
    const out = sortByFavorites(rows, ["fade"], (r) => r.label);
    expect(out.map((r) => r.label)).toEqual(["Fade", "Neon", "Cypher"]);
  });

  test("no favorites = original order unchanged", () => {
    const out = sortByFavorites(rows, [], (r) => r.label);
    expect(out.map((r) => r.label)).toEqual(["Neon", "Cypher", "Fade"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`sortByFavorites` not exported).

Run: `bun run test 2>&1 | grep -A3 sortByFavorites`

- [ ] **Step 3: Implement**

```ts
// add to apps/cli/src/domain/playback/source-name.ts

/** Stable sort: favorited rows (by normalized name) first, original order preserved within each group. */
export function sortByFavorites<T>(
  rows: readonly T[],
  favorites: readonly string[],
  labelOf: (row: T) => string,
): readonly T[] {
  const favSet = new Set(favorites);
  const isFav = (row: T): boolean => favSet.has(normalizeSourceName(labelOf(row)));
  return [...rows.filter(isFav), ...rows.filter((row) => !isFav(row))];
}

/** True when a label's normalized identity is in the favorites list. */
export function isFavoriteSource(favorites: readonly string[], label: string): boolean {
  return favorites.includes(normalizeSourceName(label));
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/domain/playback/source-name.ts apps/cli/test/unit/domain/playback/source-name.test.ts
git commit -m "feat(tracks): favorites-first stable sort + isFavoriteSource"
```

---

## Phase 2 — Auto-select preference

### Task 4: favorite preference in `selectReadyStream`

**Files:**

- Modify: `packages/providers/src/shared/startup-selection.ts`
- Test: `apps/cli/test/unit/.../startup-selection-favorites.test.ts` (place beside existing startup-selection tests — search `selectReadyStream` in `apps/cli/test` for the existing file and extend it; otherwise create `apps/cli/test/unit/providers/startup-selection-favorites.test.ts`)

> `StreamCandidate` already exposes `serverName?`, `sourceId?`, `qualityRank?` (`packages/types/src/index.ts:149`). Favorites match on `normalizeSourceName(candidate.serverName ?? candidate.flavorLabel ?? candidate.sourceId ?? "")`.

- [ ] **Step 1: Write the failing test**

```ts
// startup-selection-favorites.test.ts
import { describe, expect, test } from "bun:test";
import { selectReadyStream } from "@kunai/providers/shared/startup-selection";
import type { StreamCandidate } from "@kunai/types";

const base = {
  providerId: "vidlink",
  protocol: "hls",
  confidence: 1,
  cachePolicy: "default",
} as unknown as StreamCandidate;

const stream = (over: Partial<StreamCandidate>): StreamCandidate => ({ ...base, ...over });

describe("selectReadyStream — favorites", () => {
  const streams = [
    stream({ id: "a", serverName: "Neon", qualityRank: 1080 }),
    stream({ id: "b", serverName: "Fade", qualityRank: 1080 }),
    stream({ id: "c", serverName: "Fade", qualityRank: 720 }),
  ];

  test("prefers highest-quality favorite when no explicit selection", () => {
    const { selected, decision } = selectReadyStream(streams, { favoriteSourceNames: ["fade"] });
    expect(selected.id).toBe("b");
    expect(decision.reason).toBe("favorite-source");
  });

  test("explicit selection still wins over favorite", () => {
    const { selected } = selectReadyStream(streams, {
      favoriteSourceNames: ["fade"],
      preferredStreamId: "a",
    });
    expect(selected.id).toBe("a");
  });

  test("empty favorites = unchanged default (highest quality)", () => {
    const { selected } = selectReadyStream(streams, { favoriteSourceNames: [] });
    expect(selected.id).toBe("a"); // ordered[0] by qualityRank, original tie order
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`favoriteSourceNames` not in input type).

Run: `bun run test 2>&1 | grep -A3 "selectReadyStream — favorites"`

- [ ] **Step 3: Implement**

In `startup-selection.ts`, import the normalizer (providers package is standalone — add a tiny local copy to avoid a cross-package dep on the app):

```ts
function normalizeSourceName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}
```

Extend the `input` param type with:

```ts
    readonly favoriteSourceNames?: readonly string[];
```

After the `explicit` const and before `selected`, add the favorite pick:

```ts
const favoriteSet = new Set(input.favoriteSourceNames ?? []);
const favorite =
  favoriteSet.size > 0
    ? [...streams]
        .filter((s) =>
          favoriteSet.has(normalizeSourceName(s.serverName ?? s.flavorLabel ?? s.sourceId ?? "")),
        )
        .sort((l, r) => (r.qualityRank ?? 0) - (l.qualityRank ?? 0))[0]
    : undefined;
```

Update the `selected` line to insert favorite after explicit:

```ts
const selected =
  explicit ??
  favorite ??
  preferredQuality ??
  (startupPriority === "fast" ? streams[0] : ordered[0]);
```

Update the `reason` ternary — add the favorite branch right after the `explicit` branch:

```ts
  const reason = explicit
    ? "explicit-source"
    : favorite
      ? "favorite-source"
      : input.requiredFallback
        ? "ak-required"
        : /* ...unchanged... */;
```

> If `ProviderSelectionDecision.reason` is a string-literal union in `@kunai/types`, add `"favorite-source"` to it; if it is a plain `string`, no type change is needed.

- [ ] **Step 4: Run — expect PASS.** Also run `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/shared/startup-selection.ts apps/cli/test/unit/providers/startup-selection-favorites.test.ts packages/types/src/index.ts
git commit -m "feat(providers): prefer favorited source during auto-select"
```

> Wiring the favorites list into the _call sites_ of `selectReadyStream` (reading config → passing `favoriteSourceNames`) happens in Task 9's container wiring. This task only adds the capability.

---

## Phase 3 — Nested navigation reducer

### Task 5: `tracksPanelNavReducer`

**Files:**

- Create: `apps/cli/src/app-shell/tracks-panel-nav.ts`
- Test: `apps/cli/test/unit/app-shell/tracks-panel-nav.test.ts`

The reducer drives `{ focusedPane, sectionIndex, optionIndex }`. Sections are the visible (non-empty) `TrackCapabilityGroup`s in order. `optionCount` per section is provided via context (the count of rows in the focused section). The reducer never reaches into groups directly — it is pure over indices + a `sectionCount`/`optionCount` context.

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/app-shell/tracks-panel-nav.test.ts
import { describe, expect, test } from "bun:test";
import {
  createInitialTracksNav,
  tracksPanelNavReducer,
  type TracksNavState,
} from "@/app-shell/tracks-panel-nav";

const ctx = (sectionCount: number, optionCount: number) => ({ sectionCount, optionCount });

describe("tracksPanelNavReducer", () => {
  test("starts on sections pane at the deep-linked section index", () => {
    const s = createInitialTracksNav({ initialSectionIndex: 2 });
    expect(s).toEqual({ focusedPane: "sections", sectionIndex: 2, optionIndex: 0 });
  });

  test("down/up move between sections, clamped", () => {
    let s: TracksNavState = createInitialTracksNav({});
    s = tracksPanelNavReducer(s, { type: "down" }, ctx(4, 5));
    expect(s.sectionIndex).toBe(1);
    s = tracksPanelNavReducer({ ...s, sectionIndex: 3 }, { type: "down" }, ctx(4, 5));
    expect(s.sectionIndex).toBe(3); // clamped at last
    s = tracksPanelNavReducer({ ...s, sectionIndex: 0 }, { type: "up" }, ctx(4, 5));
    expect(s.sectionIndex).toBe(0); // clamped at first
  });

  test("enter moves focus into options at index 0", () => {
    const s = tracksPanelNavReducer(
      createInitialTracksNav({}),
      { type: "enter-section" },
      ctx(4, 5),
    );
    expect(s).toEqual({ focusedPane: "options", sectionIndex: 0, optionIndex: 0 });
  });

  test("down/up navigate options when in options pane, clamped", () => {
    let s: TracksNavState = { focusedPane: "options", sectionIndex: 0, optionIndex: 0 };
    s = tracksPanelNavReducer(s, { type: "down" }, ctx(4, 3));
    expect(s.optionIndex).toBe(1);
    s = tracksPanelNavReducer({ ...s, optionIndex: 2 }, { type: "down" }, ctx(4, 3));
    expect(s.optionIndex).toBe(2); // clamped
  });

  test("exit returns to sections pane keeping the section index", () => {
    const s = tracksPanelNavReducer(
      { focusedPane: "options", sectionIndex: 2, optionIndex: 4 },
      { type: "exit-section" },
      ctx(4, 5),
    );
    expect(s).toEqual({ focusedPane: "sections", sectionIndex: 2, optionIndex: 0 });
  });

  test("entering a section with no options stays in sections pane", () => {
    const s = tracksPanelNavReducer(
      createInitialTracksNav({}),
      { type: "enter-section" },
      ctx(4, 0),
    );
    expect(s.focusedPane).toBe("sections");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

Run: `bun run test 2>&1 | grep -A3 tracksPanelNavReducer`

- [ ] **Step 3: Implement**

```ts
// apps/cli/src/app-shell/tracks-panel-nav.ts
//
// Pure nested-navigation reducer for the Tracks panel. Mirrors browse-focus-zone.ts.
// Two panes: "sections" (left, the category list) and "options" (right, the focused
// section's rows). Indices are clamped against a context-provided count; the reducer
// never reads the capability groups directly.

export type TracksNavPane = "sections" | "options";

export type TracksNavState = {
  readonly focusedPane: TracksNavPane;
  readonly sectionIndex: number;
  readonly optionIndex: number;
};

export type TracksNavContext = {
  readonly sectionCount: number;
  /** Number of rows in the currently focused section. */
  readonly optionCount: number;
};

export type TracksNavEvent =
  | { readonly type: "up" }
  | { readonly type: "down" }
  | { readonly type: "enter-section" }
  | { readonly type: "exit-section" };

const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max));

export function createInitialTracksNav(input: {
  readonly initialSectionIndex?: number;
}): TracksNavState {
  return {
    focusedPane: "sections",
    sectionIndex: Math.max(0, input.initialSectionIndex ?? 0),
    optionIndex: 0,
  };
}

export function tracksPanelNavReducer(
  state: TracksNavState,
  event: TracksNavEvent,
  ctx: TracksNavContext,
): TracksNavState {
  switch (event.type) {
    case "down":
      return state.focusedPane === "sections"
        ? { ...state, sectionIndex: clamp(state.sectionIndex + 1, ctx.sectionCount - 1) }
        : { ...state, optionIndex: clamp(state.optionIndex + 1, ctx.optionCount - 1) };
    case "up":
      return state.focusedPane === "sections"
        ? { ...state, sectionIndex: clamp(state.sectionIndex - 1, ctx.sectionCount - 1) }
        : { ...state, optionIndex: clamp(state.optionIndex - 1, ctx.optionCount - 1) };
    case "enter-section":
      if (ctx.optionCount <= 0) return state;
      return { ...state, focusedPane: "options", optionIndex: 0 };
    case "exit-section":
      return { ...state, focusedPane: "sections", optionIndex: 0 };
    default:
      return state;
  }
}

export const isOptionsFocused = (s: TracksNavState): boolean => s.focusedPane === "options";
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/tracks-panel-nav.ts apps/cli/test/unit/app-shell/tracks-panel-nav.test.ts
git commit -m "feat(tracks): pure nested-navigation reducer"
```

---

## Phase 4 — Layout model

### Task 6: counts header + subtitle grid chunking

**Files:**

- Create: `apps/cli/src/app-shell/tracks-panel-layout.ts`
- Test: `apps/cli/test/unit/app-shell/tracks-panel-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/app-shell/tracks-panel-layout.test.ts
import { describe, expect, test } from "bun:test";
import { tracksCountsHeader, chunkSubtitleGrid } from "@/app-shell/tracks-panel-layout";

describe("tracksCountsHeader", () => {
  test("joins present counts, omits zeros, appends provider when given", () => {
    expect(tracksCountsHeader({ source: 1, quality: 3, audio: 0, subtitle: 10 }, "vidlink")).toBe(
      "1 source · 3 qualities · 10 subtitles · vidlink",
    );
  });
  test("singular/plural and no provider", () => {
    expect(tracksCountsHeader({ source: 2, quality: 1, audio: 1, subtitle: 0 })).toBe(
      "2 sources · 1 quality · 1 audio",
    );
  });
});

describe("chunkSubtitleGrid", () => {
  test("wraps labels into rows of `columns`", () => {
    const labels = ["EN", "ES", "FR", "DE", "IT"];
    expect(chunkSubtitleGrid(labels, 2)).toEqual([["EN", "ES"], ["FR", "DE"], ["IT"]]);
  });
  test("columns < 1 coerces to single column", () => {
    expect(chunkSubtitleGrid(["EN", "ES"], 0)).toEqual([["EN"], ["ES"]]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `bun run test 2>&1 | grep -A3 tracksCountsHeader`

- [ ] **Step 3: Implement**

```ts
// apps/cli/src/app-shell/tracks-panel-layout.ts

export type TrackSectionCounts = {
  readonly source: number;
  readonly quality: number;
  readonly audio: number;
  readonly subtitle: number;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "1 source · 3 qualities · 10 subtitles · <provider>" — omits zero counts, provider optional. */
export function tracksCountsHeader(counts: TrackSectionCounts, provider?: string): string {
  const parts = [
    counts.source ? plural(counts.source, "source", "sources") : null,
    counts.quality ? plural(counts.quality, "quality", "qualities") : null,
    counts.audio ? plural(counts.audio, "audio", "audio") : null,
    counts.subtitle ? plural(counts.subtitle, "subtitle", "subtitles") : null,
    provider && provider.trim() ? provider.trim() : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join("  ·  ").replace(/ {2}·{1} {2}/g, " · ");
}

/** Wrap labels into rows of `columns` for the subtitle chip grid. */
export function chunkSubtitleGrid<T>(labels: readonly T[], columns: number): T[][] {
  const cols = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let i = 0; i < labels.length; i += cols) rows.push(labels.slice(i, i + cols));
  return rows;
}
```

> Note the test expects single-space `·` separators; the implementation normalizes the join. If the snapshot in Task 7 prefers a different separator, keep the test and impl in sync — the test is the contract.

- [ ] **Step 4: Run — expect PASS.** Fix separator handling until both header tests pass exactly.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/tracks-panel-layout.ts apps/cli/test/unit/app-shell/tracks-panel-layout.test.ts
git commit -m "feat(tracks): counts-header + subtitle-grid layout helpers"
```

---

## Phase 5 — Render

### Task 7: Two-pane `TracksPanelShell`

**Files:**

- Modify: `apps/cli/src/app-shell/tracks-panel-shell.tsx` (full rewrite of the render body; keep the export name + props, add new optional props)
- Test: `apps/cli/test/unit/app-shell/tracks-panel-shell.test.tsx` (render via the local `apps/cli/test/harness/render-capture.ts` harness — width-controllable + flicker-probe; `ink-testing-library` is intentionally NOT used)

New props (additive, defaulted so existing callers compile):

```ts
export type TracksPanelShellProps = {
  groups: readonly TrackCapabilityGroup[];
  width: number;
  height?: number;
  nav: TracksNavState; // from tracks-panel-nav.ts
  favorites?: readonly string[]; // normalized names
  providerLabel?: string; // counts-header tail (was "host")
  filterQuery?: string;
};
```

Render contract:

- Header: brand + `[Tracks]` + crumb, then `tracksCountsHeader(...)`.
- If `width >= 56`: two columns. **Left** = one row per visible section: `▸`/space marker (marker shown when `nav.focusedPane === "sections" && index === nav.sectionIndex`), section title, current value (the `selected` row's label, or the first fact). **Right** = the focused section's rows; for `subtitle` use `chunkSubtitleGrid` into a chip grid, otherwise a row list; highlight `nav.optionIndex` only when `nav.focusedPane === "options"`. Source rows show `♥` when `isFavoriteSource(favorites, label)`, sorted via `sortByFavorites`.
- If `width < 56`: render the existing stacked single-column view (reuse current logic) honoring `nav` for the highlighted row.
- Footer: `↑↓ choose · → enter · ⏎ switch · f favorite · esc back` (favorite hint only when the focused section is `source`).

- [ ] **Step 1: Write the failing test** (behavioral, not pixel-exact)

```tsx
// apps/cli/test/unit/app-shell/tracks-panel-shell.test.tsx
import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { TracksPanelShell } from "@/app-shell/tracks-panel-shell";
import { createInitialTracksNav } from "@/app-shell/tracks-panel-nav";
import type { TrackCapabilityGroup } from "@/domain/playback/track-capabilities";

const groups: TrackCapabilityGroup[] = [
  {
    section: "source",
    title: "Source",
    selectable: true,
    rows: [
      {
        section: "source",
        label: "Neon",
        value: "neon",
        selected: true,
        enabled: false,
        risk: "normal",
      },
      {
        section: "source",
        label: "Fade",
        value: "fade",
        selected: false,
        enabled: true,
        risk: "normal",
      },
    ],
  },
];

describe("TracksPanelShell two-pane", () => {
  test("shows counts header and a ♥ on a favorited source", () => {
    const { lastFrame } = render(
      <TracksPanelShell
        groups={groups}
        width={80}
        nav={createInitialTracksNav({})}
        favorites={["fade"]}
        providerLabel="vidlink"
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 source");
    expect(frame).toContain("♥");
    expect(frame).toContain("Fade");
  });

  test("narrow width falls back to single column (no crash, shows rows)", () => {
    const { lastFrame } = render(
      <TracksPanelShell groups={groups} width={40} nav={createInitialTracksNav({})} />,
    );
    expect(lastFrame() ?? "").toContain("Neon");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (props `nav`/`favorites` not accepted, no `♥`).

Run: `bun run test 2>&1 | grep -A4 "TracksPanelShell two-pane"`

- [ ] **Step 3: Implement the rewrite.** Use `palette` from `./shell-theme`, `truncateLine` from `./shell-text`, the helpers from Tasks 1/3/6, and `TracksNavState`. Keep `React.memo`. Build the left column from `groups` (current value = `rows.find(r => r.selected)?.label ?? rows[0]?.label ?? "—"`). Build the right column from `groups[nav.sectionIndex]`. Sort source rows with `sortByFavorites(rows, favorites, r => r.label)` and prefix `♥ ` when favorited. For subtitle sections, map labels through `chunkSubtitleGrid(labels, Math.max(1, Math.floor((width/2)/14)))` and render each chunk as a `<Box flexDirection="row">` of chips, current marked `✓`. Below 56 cols, render the prior stacked body.

- [ ] **Step 4: Run — expect PASS.** Then `bun run typecheck && bun run lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/tracks-panel-shell.tsx apps/cli/test/unit/app-shell/tracks-panel-shell.test.tsx
git commit -m "feat(tracks): two-pane nested render + ♥ + grid subtitles + narrow fallback"
```

---

## Phase 6 — Wiring

### Task 8: Overlay state + `openTracksPanel` thread favorites

**Files:**

- Modify: the `tracks_panel` `OverlayState` definition (search `type: "tracks_panel"` in the overlay/state types — likely `apps/cli/src/app-shell/types.ts` or a state module) to add `favorites: readonly string[]` and keep `initialSection`.
- Modify: `apps/cli/src/app-shell/workflows.ts` — `openTracksPanel` reads favorites from config and includes them in the dispatched overlay.

- [ ] **Step 1:** Add `readonly favorites: readonly string[]` to the `tracks_panel` overlay variant. Run `bun run typecheck` to surface every construction site (expect the `OPEN_OVERLAY` dispatch in `workflows.ts:2069` to error — good).

- [ ] **Step 2:** In `openTracksPanel`, read favorites from the container's config service and pass them:

```ts
const favorites = container.config.get().favoriteSources; // match the actual ConfigService accessor
container.stateManager.dispatch({
  type: "OPEN_OVERLAY",
  overlay: { type: "tracks_panel", id, groups, initialSection: options.initialSection, favorites },
});
```

> Confirm the real config accessor on `Container` (search `container.config` or `ConfigService` usage in `workflows.ts`). Use whatever the surrounding code uses to read `KitsuneConfig`.

- [ ] **Step 3:** Run `bun run typecheck` — expect PASS once all construction sites supply `favorites`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(tracks): carry favorites on tracks_panel overlay"
```

---

### Task 9: Reducer-driven input routing + `f` favorite + auto-select wiring

**Files:**

- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (the `useInput` block at line ~826–872, the `tracks_panel` render at ~1658–1675, and the derived state near ~419–427)
- Modify: the call sites of `selectReadyStream` (search `selectReadyStream(` under `apps/cli/src` and `packages/providers`) to pass `favoriteSourceNames` from config — or thread it through the existing stream-request adapter (`apps/cli/src/services/providers/stream-request-adapter.ts`).

- [ ] **Step 1:** Replace the flat `selectedIndex` model for `tracks_panel` with reducer state. Near the other `tracks_panel` derived values (~419), add:

```tsx
const [tracksNav, setTracksNav] = React.useState<TracksNavState>(() =>
  createInitialTracksNav({ initialSectionIndex: tracksInitialSectionIndex }),
);
```

where `tracksInitialSectionIndex` maps `overlay.initialSection` to its index in the visible groups (compute from `trackGroups`).

- [ ] **Step 2:** Rewrite the `if (overlay.type === "tracks_panel")` input branch:

```tsx
if (overlay.type === "tracks_panel") {
  const sectionCount = trackGroups.length;
  const optionCount = trackGroups[tracksNav.sectionIndex]?.rows.length ?? 0;
  const ctx = { sectionCount, optionCount };
  if (key.escape) {
    if (tracksNav.focusedPane === "options") {
      setTracksNav((s) => tracksPanelNavReducer(s, { type: "exit-section" }, ctx));
      return;
    }
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    container.stateManager.dispatch({ type: "CANCEL_PICKER", id: overlay.id });
    return;
  }
  if (key.leftArrow && tracksNav.focusedPane === "options") {
    setTracksNav((s) => tracksPanelNavReducer(s, { type: "exit-section" }, ctx));
    return;
  }
  if (key.rightArrow && tracksNav.focusedPane === "sections") {
    setTracksNav((s) => tracksPanelNavReducer(s, { type: "enter-section" }, ctx));
    return;
  }
  if (key.upArrow || key.downArrow) {
    setTracksNav((s) => tracksPanelNavReducer(s, { type: key.upArrow ? "up" : "down" }, ctx));
    return;
  }
  if (key.return) {
    if (tracksNav.focusedPane === "sections") {
      setTracksNav((s) => tracksPanelNavReducer(s, { type: "enter-section" }, ctx));
      return;
    }
    const group = trackGroups[tracksNav.sectionIndex];
    const row = group?.rows[tracksNav.optionIndex];
    if (!group || !row || !row.enabled) return; // facts never resolve
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    container.stateManager.dispatch({
      type: "RESOLVE_PICKER",
      id: overlay.id,
      value: encodeTrackSelection(row.section, row.value),
    });
    return;
  }
  if (input === "f" && trackGroups[tracksNav.sectionIndex]?.section === "source") {
    const row = trackGroups[tracksNav.sectionIndex]?.rows[tracksNav.optionIndex];
    if (row) {
      const next = toggleFavoriteSource(currentFavorites, row.label);
      void container.config.update({ favoriteSources: next }); // match real ConfigService write API
    }
    return;
  }
  return;
}
```

> `container.config.update(...)` is a placeholder for the real persist call — use whatever ConfigService exposes (e.g. `setConfig`, `patch`, `save`). The favorites the panel renders should come from the overlay's `favorites` (Task 8) and re-read after a toggle so the ♥ + sort update live.

- [ ] **Step 3:** Update the `TracksPanelShell` render (~1658) to pass `nav={tracksNav}`, `favorites={overlay.favorites}`, `providerLabel={...}` instead of `selectedIndex`/`activeSection`.

- [ ] **Step 4:** Wire favorites into auto-select: at the `selectReadyStream` call site, read `favoriteSources` from config and pass `favoriteSourceNames`. Add/extend a unit test for the adapter if one exists.

- [ ] **Step 5:** `bun run typecheck && bun run lint && bun run test`. Commit:

```bash
git add -A
git commit -m "feat(tracks): reducer-driven panel input, f-to-favorite, favorite auto-select wiring"
```

---

### Task 10: Drop `/tracks` command, keep deep-links, `s` opens source

**Files:**

- Modify: the command registry (search `"/tracks"` / `tracks` command id across `apps/cli/src/app-shell/`; `ink-shell.tsx:194` and `workflows.ts` reference the three commands — find where `/tracks`, `/source`, `/quality` are registered).
- Modify: the keybinding registry (search for the active-playback `t` binding) so `s` opens the panel at the Source section; remove any `t`→tracks advertisement.
- Add `/audio` and `/subtitles` deep-link commands (mapping to `initialSection: "audio" | "subtitle"`).

- [ ] **Step 1:** Remove the `/tracks` command registration + its help/footer entry. Keep `/source`→`{initialSection:"source"}`, `/quality`→`{initialSection:"quality"}`; add `/audio`→`{initialSection:"audio"}`, `/subtitles`→`{initialSection:"subtitle"}`.

- [ ] **Step 2:** Bind `s` (active playback) → `openTracksPanel(stream, { initialSection: "source" }, container)`. Update footer hints + help registry so `s` reads as "servers" and `/tracks` is gone.

- [ ] **Step 3:** Grep to confirm no remaining `/tracks` references: `grep -rn "/tracks" apps/cli/src`. Expected: only doc/comment mentions, no live command.

- [ ] **Step 4:** `bun run typecheck && bun run lint && bun run test`. Commit:

```bash
git add -A
git commit -m "feat(tracks): drop redundant /tracks command; s opens servers; add /audio /subtitles deep-links"
```

---

## Phase 7 — Verify & document

### Task 11: Gates + live-verify checklist + docs

- [ ] **Step 1:** Full gate:

```bash
bun run typecheck && bun run lint && bun run test && bun run build
```

Expected: all green; build emits `dist/kunai.js`.

- [ ] **Step 2:** Live-verify in the user's terminal (no TTY here — hand to user):
  - `/source` opens the panel at Source; `↑↓` moves sections, `→` enters, `↑↓` picks a server, `⏎` switches and restarts at the right stream.
  - `f` on a server toggles ♥, pins it to top, and persists (reopen panel → still ♥; check `~/.config/kunai/config.json` has `favoriteSources`).
  - With a favorite set, starting a new episode auto-selects the favorited server when available.
  - `/quality`, `/audio`, `/subtitles` deep-link to their sections; subtitles render as a grid; counts header is correct.
  - Narrow terminal (<56 cols) falls back to the stacked view without crashing.

- [ ] **Step 3:** Update `.docs/ux-architecture.md` (tracks panel section) and `apps/cli/src/domain/playback/track-capabilities.ts` doc comment (it still says `/tracks`) to match the new command surface. Commit:

```bash
git add -A
git commit -m "docs(tracks): nested panel + favorites command surface"
```

- [ ] **Step 4:** Update the spec `Status:` to `Implemented` and the memory `project_ux_v2_decomposition` (mark sub-project A done). Commit.

---

## Self-Review notes

- **Spec coverage:** §1 nav → Tasks 5,7,9; §2 favorites → Tasks 1,2,3,4,8,9; §3 grid+header → Tasks 6,7; §4 routing → Tasks 8,10; §5 testing → every task + Task 11. Covered.
- **Type consistency:** `TracksNavState` shape is identical across Tasks 5/7/9; `normalizeSourceName`/`sortByFavorites`/`isFavoriteSource`/`toggleFavoriteSource` signatures consistent; `selectReadyStream` input extension matches the call-site wiring in Task 9.
- **Known placeholders requiring confirmation at execution time (flagged inline, not plan gaps):** the exact `ConfigService` read/write method names, the exact `Container.config` accessor, the `tracks_panel` `OverlayState` file location, and the command-registry file. Each task says how to find the real symbol before editing.
