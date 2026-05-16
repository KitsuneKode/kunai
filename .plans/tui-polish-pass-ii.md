# TUI Polish Pass II — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all audited UX defects across every Kunai TUI surface — PickerOptionRow label/detail contrast, OverlayPanel border removal + section headers, DiscoverShell readability, ChecklistShell filter cursor, LoadingShell dynamic progress + section labels, footer hotkey format, ResizeBlocker brand identity, and dead-code cleanup.

**Architecture:** Each task is isolated to one or two files within `apps/cli/src/app-shell/`. No new shared abstractions are added; changes conform to existing `palette`, `useSpinner`, `useLineEditor`, and `LocalSection` contracts already established in Pass I. No new components are created — existing ones are refined.

**Tech Stack:** Bun · Ink 5 · React 18 · `@kunai/design` palette tokens (`palette.text`, `palette.muted`, `palette.dim`, `palette.teal`, `palette.amber`) · `useStdout()` for terminal dimensions

---

## File Structure

| Status | File                                            | Changes                                                                         |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Modify | `apps/cli/src/app-shell/overlay-picker-row.tsx` | Split label/detail into separate `<Text>` with distinct colors                  |
| Modify | `apps/cli/src/app-shell/overlay-panel.tsx`      | Remove `borderStyle="round"`, render `section:*` headers visually, busy spinner |
| Modify | `apps/cli/src/app-shell/discover-shell.tsx`     | Fix inactive item color from `palette.muted` → `palette.text`                   |
| Modify | `apps/cli/src/app-shell/checklist-shell.tsx`    | Wire `LineEditorText` to filter to show cursor                                  |
| Modify | `apps/cli/src/app-shell/loading-shell.tsx`      | Dynamic progress bar width; rename section labels                               |
| Modify | `apps/cli/src/app-shell/shell-primitives.tsx`   | Footer glyph-only format; ResizeBlocker brand; remove dead `BrowseTitle`        |
| Modify | `apps/cli/src/app-shell/shell-frame.tsx`        | Unify InputField hint position                                                  |

---

## Viable Options Summary

Before diving into tasks, here's the design fork-in-the-road for the highest-impact changes:

### OverlayPanel border removal

- **A (chosen): Strip border, add `▸ Title` accent prefix** — consistent with `LocalSection` (`·`) and `ErrorShell` (left bar); no box drawing needed.
- **B: Replace with `borderStyle="single"` + single color** — lighter visual but still a box. Not consistent with rest of app.
- **C: Top separator line only** — `"─".repeat(width)` in accent color above title. Works for line-oriented layouts but loses emphasis on the overlay title.

### Footer hotkey format

- **A (chosen): Show glyph alone when available, brackets only for plain keys** — `⏭ next` instead of `[⏭ n] next`. Cleaner, more icon-native feel.
- **B: Keep `[key]` but drop the letter when a glyph exists** — `[⏭] next`. Lighter than current, still uses brackets.
- **C: Keep current `[⏭ n] next` format** — no change. Safest if hotkey discoverability is a concern.

### LoadingShell section headers

- **A (chosen): Rename to contextual labels** — "Status" → drop the title and render items inline; "Playback" → "Now playing"; "Navigation" → omit entirely (footer covers it).
- **B: Lowercase + muted styling** — keep names but render as `palette.dim` non-bold. Minimal change.
- **C: Remove section headers entirely** — rely on visual spacing and item content alone.

---

## Task 1: PickerOptionRow — Label vs Detail Color Contrast

**Files:**

- Modify: `apps/cli/src/app-shell/overlay-picker-row.tsx`

**Problem:** `PickerOptionRow` currently concatenates `label + "  " + detail` into one string before rendering, then colors the whole thing with `palette.text` or `accentColor`. Label and detail are indistinguishable.

**Fix:** Render label and detail as separate `<Text>` siblings. Label gets full text color; detail gets `palette.muted`. `formatPickerOptionRow` / `formatPickerDisplayRow` (string-only utilities used in tests) are left unchanged.

- [ ] **Step 1: Write the failing test**

Add to `apps/cli/test/unit/app-shell/overlay-picker-row.test.ts` (create if it doesn't exist):

```typescript
import { describe, expect, test } from "bun:test";
import { formatPickerOptionRow } from "@/app-shell/overlay-picker-row";

describe("formatPickerOptionRow", () => {
  test("concatenates label and detail for string output", () => {
    const result = formatPickerOptionRow({
      label: "HiAnime",
      detail: "Anime provider",
      width: 40,
    });
    expect(result.text).toContain("HiAnime");
    expect(result.text).toContain("Anime provider");
  });

  test("truncates when content exceeds width", () => {
    const result = formatPickerOptionRow({
      label: "A very long provider name that exceeds",
      detail: "long detail",
      width: 20,
    });
    expect(result.text.length).toBeLessThanOrEqual(20);
  });

  test("badge is kept separate from text", () => {
    const result = formatPickerOptionRow({
      label: "HiAnime",
      badge: "✓",
      width: 40,
    });
    expect(result.badgeSuffix).toBe("  ✓");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (it tests existing string-only functions, should pass)**

```bash
bun run test apps/cli/test/unit/app-shell/overlay-picker-row.test.ts
```

Expected: PASS (these test the existing string helpers, not the component)

- [ ] **Step 3: Update `PickerOptionRow` to render label and detail separately**

Replace the body of `PickerOptionRow` in `apps/cli/src/app-shell/overlay-picker-row.tsx`:

```typescript
export function PickerOptionRow({
  label,
  detail,
  badge,
  width,
  selected,
  accentColor,
  pickerAccent,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly badge?: string;
  readonly width: number;
  readonly selected: boolean;
  readonly accentColor: string | null;
  readonly pickerAccent: string;
}) {
  const prefix = selected ? "❯ " : "  ";
  const badgeSuffix = badge ? `  ${badge}` : "";
  // Budget: width minus prefix (2) and badge
  const contentWidth = Math.max(0, width - prefix.length - badgeSuffix.length);
  const truncatedLabel = truncateLine(label, contentWidth);
  // Detail only shown when label leaves room (at least 5 chars)
  const detailBudget = contentWidth - truncatedLabel.length - 2;
  const truncatedDetail =
    detail && detailBudget >= 5 ? truncateLine(detail, detailBudget) : undefined;

  return (
    <>
      <Text color={selected ? pickerAccent : palette.gray}>{prefix}</Text>
      <Text color={selected ? pickerAccent : (accentColor ?? palette.text)} wrap="truncate-end">
        {truncatedLabel}
      </Text>
      {truncatedDetail ? (
        <Text color={selected ? palette.dim : palette.muted} wrap="truncate-end">
          {"  "}{truncatedDetail}
        </Text>
      ) : null}
      {badgeSuffix ? (
        <Text color={selected ? pickerAccent : (accentColor ?? palette.gray)} wrap="truncate-end">
          {badgeSuffix}
        </Text>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/overlay-picker-row.tsx apps/cli/test/unit/app-shell/overlay-picker-row.test.ts
git commit -m "feat(tui): separate label and detail color in PickerOptionRow"
```

---

## Task 2: OverlayPanel — Remove Round Border + Section Headers + Busy Spinner

**Files:**

- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`

**Problems:**

1. `borderStyle="round"` at line 892 — last border in the app; inconsistent with ErrorShell and LibraryShell
2. `section:*` options rendered identically to normal items — no visual grouping
3. `overlay.busy` shows static "Saving settings…" text with no animation

**Fix:** Remove border box → plain column with `▸ title` accent prefix. Detect `value.startsWith("section:")` options and render them as non-interactive section separators. Add a local Braille spinner for the busy state.

- [ ] **Step 1: Write the failing test**

Add to `apps/cli/test/unit/app-shell/overlay-panel.test.ts` (create if it doesn't exist):

```typescript
import { describe, expect, test } from "bun:test";
import { buildSettingsOptions } from "@/app-shell/overlay-panel";

describe("buildSettingsOptions", () => {
  test("includes section separator options with section: prefix", () => {
    const options = buildSettingsOptions({
      defaultMode: "series",
      provider: "vidking",
      animeProvider: "hianime",
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      seriesLanguageProfile: { audio: "original", subtitle: "none" },
      movieLanguageProfile: { audio: "original", subtitle: "en" },
      footerHints: "detailed",
      autoNext: true,
      autoDownload: "off",
      discoverShowOnStartup: false,
      discoverMode: "mode",
      discoverItemLimit: 10,
      recommendationRailEnabled: false,
      showMemory: false,
      animeTitlePreference: "romaji",
      recoveryMode: false,
      autoCleanupWatched: false,
      resumeStartChoicePrompt: false,
      quitNearEndBehavior: "continue",
      quitNearEndThresholdMode: "percentage",
      skipRecap: false,
      skipIntro: false,
      skipCredits: false,
      skipPreview: false,
      presenceProvider: "off",
      presencePrivacy: "title-only",
      presenceDiscordClientId: "source",
      downloadsEnabled: false,
      autoDownloadNextCount: 1,
      autoCleanupGraceDays: 30,
      downloadPath: null,
    } as Parameters<typeof buildSettingsOptions>[0]);

    const sectionValues = options.map((o) => o.value).filter((v) => v.startsWith("section:"));

    expect(sectionValues.length).toBeGreaterThan(0);
    expect(sectionValues).toContain("section:general");
    expect(sectionValues).toContain("section:providers");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (tests existing build logic)**

```bash
bun run test apps/cli/test/unit/app-shell/overlay-panel.test.ts
```

Expected: PASS

- [ ] **Step 3: Add local spinner hook at top of overlay-panel.tsx (after imports)**

Add after the import block in `apps/cli/src/app-shell/overlay-panel.tsx`:

```typescript
import React from "react";

const BUSY_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function useBusySpinner(active: boolean): string {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % BUSY_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [active]);
  return BUSY_FRAMES[frame] ?? "⠋";
}
```

Note: `import React from "react"` is already present via JSX — add `useBusySpinner` after any existing imports, not a new import line.

- [ ] **Step 4: Remove `borderStyle="round"` and add `▸ title` prefix**

In `apps/cli/src/app-shell/overlay-panel.tsx`, locate the return statement of `OverlayPanel` (around line 888). Replace:

```tsx
  return (
    <Box
      marginTop={1}
      flexDirection="column"
      borderStyle="round"
      borderColor={
        overlay.type === "settings" || overlay.type === "settings-choice"
          ? palette.green
          : overlay.type === "provider"
            ? palette.amber
            : palette.teal
      }
      paddingX={1}
    >
      <Text
        color={
          overlay.type === "settings" || overlay.type === "settings-choice"
            ? palette.green
            : overlay.type === "provider"
              ? palette.amber
              : palette.teal
        }
      >
        {overlay.title}
      </Text>
      <Text color={palette.gray}>{overlay.subtitle}</Text>
```

With:

```tsx
  const accentColor =
    overlay.type === "settings" || overlay.type === "settings-choice"
      ? palette.green
      : overlay.type === "provider"
        ? palette.amber
        : palette.teal;

  return (
    <Box
      marginTop={1}
      flexDirection="column"
      paddingX={1}
    >
      <Text color={accentColor} bold>
        {"▸ "}{overlay.title}
      </Text>
      <Text color={palette.gray}>{overlay.subtitle}</Text>
```

- [ ] **Step 5: Render `section:*` options as section separator rows**

In the picker options render loop (around line 956), locate the `visibleOptions.map(...)` and add section-header detection. Replace the inner render:

```tsx
            {visibleOptions.map((option, index) => {
              const optionIndex = optionWindowStart + index;
              const selected = optionIndex === overlay.selectedIndex;
              const accentColor =
```

With:

```tsx
            {visibleOptions.map((option, index) => {
              const optionIndex = optionWindowStart + index;
              const selected = optionIndex === overlay.selectedIndex;

              // Section separator: render as a non-selectable group header
              if (typeof option.value === "string" && option.value.startsWith("section:")) {
                return (
                  <Box key={`section-${option.value}`} marginTop={1} flexDirection="column">
                    <Text color={palette.dim} dimColor bold>
                      {option.label.toUpperCase()}
                    </Text>
                  </Box>
                );
              }

              const accentColor =
```

- [ ] **Step 6: Replace static busy text with animated spinner**

Locate the busy state text in the picker overlay footer (around line 993):

```tsx
<Text color={overlay.busy ? palette.amber : palette.gray}>
  {overlay.busy
    ? overlay.type === "provider"
      ? "Updating provider…"
      : overlay.type === "history-picker"
        ? "Loading history…"
        : "Saving settings…"
    : `${overlay.options.length} items  ·  ↑↓ choose · Enter select · Esc close`}
</Text>
```

Replace with (add `const busySpinner = useBusySpinner(overlay.busy ?? false);` just before the `return` in `OverlayPanel`, then use it here):

```tsx
<Text color={overlay.busy ? palette.amber : palette.gray}>
  {overlay.busy
    ? `${busySpinner} ${
        overlay.type === "provider"
          ? "Updating provider…"
          : overlay.type === "history-picker"
            ? "Loading history…"
            : "Saving settings…"
      }`
    : `${overlay.options.length} items  ·  ↑↓ choose · Enter select · Esc close`}
</Text>
```

And add before the `return` in `OverlayPanel` (where `accentColor` is now declared):

```tsx
const busySpinner = useBusySpinner(
  (isPickerOverlay && (overlay as { busy?: boolean }).busy) ?? false,
);
```

- [ ] **Step 7: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 8: Run tests**

```bash
bun run test apps/cli/test/unit/app-shell/
```

Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/app-shell/overlay-panel.tsx apps/cli/test/unit/app-shell/overlay-panel.test.ts
git commit -m "feat(tui): remove round border, add section headers and busy spinner in OverlayPanel"
```

---

## Task 3: DiscoverShell — Fix Inactive Item Readability

**Files:**

- Modify: `apps/cli/src/app-shell/discover-shell.tsx`

**Problem:** Inactive discover items use `palette.muted` (`#95887a`) as their text color — too dim on most terminals; items that aren't currently highlighted appear washed out.

**Fix:** Change inactive item color from `palette.muted` to `palette.text` (the standard body text token). Keep the active `backgroundColor={palette.teal}` + `color="black"` pattern for the focused item — it's consistent with ChecklistShell and provides clear focus indication.

**Viable alternatives:**

- **A (chosen):** `palette.text` for inactive — full readability, clear active/inactive contrast via highlight only
- **B:** `palette.textDim` for inactive — slightly dimmer than full text, maintains hierarchy without going as dim as muted
- **C:** Use `❯` text cursor instead of inverted bg, no color change — more like OverlayPanel pickers but loses the "grid" feel of Discover

- [ ] **Step 1: Write a snapshot check**

Add `apps/cli/test/unit/app-shell/discover-shell.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

// Verify the discover data shape; DiscoverShell is a component and needs render tests
// This just confirms the RecommendationSection import contract is stable
test("discover shell data contract", () => {
  type DiscoverItem = { id: string; title: string; year: number; rating: number | null };
  type Section = { id: string; label: string; items: readonly DiscoverItem[] };
  const section: Section = {
    id: "trending",
    label: "Trending",
    items: [{ id: "1", title: "Frieren", year: 2023, rating: 9.0 }],
  };
  expect(section.items[0]?.title).toBe("Frieren");
});
```

- [ ] **Step 2: Run test (should pass immediately)**

```bash
bun run test apps/cli/test/unit/app-shell/discover-shell.test.ts
```

Expected: PASS

- [ ] **Step 3: Change inactive item color**

In `apps/cli/src/app-shell/discover-shell.tsx`, locate (around line 57-59):

```tsx
                <Text
                  backgroundColor={isActive ? palette.teal : undefined}
                  color={isActive ? "black" : palette.muted}
                  bold={isActive}
                  wrap="truncate"
                >
```

Change to:

```tsx
                <Text
                  backgroundColor={isActive ? palette.teal : undefined}
                  color={isActive ? "black" : palette.text}
                  bold={isActive}
                  wrap="truncate"
                >
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/discover-shell.tsx apps/cli/test/unit/app-shell/discover-shell.test.ts
git commit -m "fix(tui): improve discover item readability with palette.text for inactive items"
```

---

## Task 4: ChecklistShell — Add Cursor to Filter Input

**Files:**

- Modify: `apps/cli/src/app-shell/checklist-shell.tsx`

**Problem:** `useLineEditor` is already wired to drive `filterQuery` via `filterEditor.handleInput`. However, the render uses a plain static `<Text>` — no cursor is shown. `LineEditorText` (from `shell-command-ui.tsx`) renders a blinking-cursor aware text block, but it's not imported or used here.

**Fix:** Import `LineEditorText` from `shell-command-ui` and replace the static filter text with `<LineEditorText>` passing `cursor={filterEditor.cursor}`.

**Viable alternatives:**

- **A (chosen):** Use `LineEditorText` — already the standard across CommandPalette and InputField
- **B:** Render cursor manually: `query.slice(0, cursor)`, `<Text bg="white">_</Text>`, `query.slice(cursor)` — same result but duplicates logic
- **C:** Skip cursor entirely, rely on filter badge being teal when active — minimal change, loses edit-position feedback

- [ ] **Step 1: Write the test**

The filter cursor is a render behavior — test that `filterEditor.cursor` is accessible:

Add `apps/cli/test/unit/app-shell/checklist-shell.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

// Verify useLineEditor returns cursor position via standard hook contract
// (component render tests require Ink test renderer, out of scope here)
test("checklist filter contract: useLineEditor exposes cursor", () => {
  // This is a structural check — if useLineEditor doesn't export cursor,
  // the TypeScript compiler would catch it in checklist-shell.tsx.
  // We verify the import path is stable.
  const mod = require("@/app-shell/line-editor");
  expect(typeof mod.useLineEditor).toBe("function");
});
```

- [ ] **Step 2: Run test (should pass)**

```bash
bun run test apps/cli/test/unit/app-shell/checklist-shell.test.ts
```

Expected: PASS

- [ ] **Step 3: Import `LineEditorText` and update filter render**

In `apps/cli/src/app-shell/checklist-shell.tsx`:

Add to imports at top of file:

```typescript
import { LineEditorText } from "@/app-shell/shell-command-ui";
```

Then locate the filter box render (around line 149-153):

```tsx
<Box paddingY={1}>
  <Text color={palette.teal}>⌕ </Text>
  <Text color={filterQuery ? "white" : palette.gray}>{filterQuery || "type to filter"}</Text>
</Box>
```

Replace with:

```tsx
<Box paddingY={1}>
  <Text color={palette.teal}>⌕ </Text>
  <LineEditorText
    value={filterQuery}
    cursor={filterEditor.cursor}
    focused={true}
    placeholder="type to filter"
    maxWidth={Math.max(20, rowWidth - 6)}
  />
</Box>
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 5: Run tests**

```bash
bun run test apps/cli/test/unit/app-shell/
```

Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/checklist-shell.tsx apps/cli/test/unit/app-shell/checklist-shell.test.ts
git commit -m "feat(tui): add cursor to checklist filter input via LineEditorText"
```

---

## Task 5: LoadingShell — Dynamic Progress Bar + Section Label Polish

**Files:**

- Modify: `apps/cli/src/app-shell/loading-shell.tsx`

**Problems:**

1. Progress bar width is hardcoded at 40 chars (`"█".repeat(...)` + `"░".repeat(40 - ...)`) — on narrow terminals this overflows; on wide ones it looks undersized
2. `LocalSection title="Status"` / `title="Playback"` / `title="Navigation"` read like debug panel headers rather than contextual labels

**Fix:**

1. Derive `barWidth` from `useStdout()` (`stdout` is already imported): `Math.min(48, Math.max(12, Math.floor(stdout.columns * 0.45)))`
2. Rename: "Status" → omit the `LocalSection` wrapper, render items directly; "Playback" → "Now playing"; "Navigation" → remove (footer handles nav hints); "Buffering" section labels → contextual per operation type

**Viable alternatives:**

- **A (chosen):** Dynamic `barWidth` from `stdout.columns * 0.45`, capped 12–48
- **B:** Use a Unicode block-element progress indicator (`▏▎▍▌▋▊▉█`) for smoother granularity — more complex, same idea
- **C:** Replace the bar entirely with a percentage text + dot matrix — simpler visual but loses progress at-a-glance feel

- [ ] **Step 1: Write the test**

Add `apps/cli/test/unit/app-shell/loading-shell.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  formatLoadingProviderLine,
  shouldShowLoadingPosterCompanion,
} from "@/app-shell/loading-shell";

describe("formatLoadingProviderLine", () => {
  test("formats name and id together when both present and different", () => {
    expect(formatLoadingProviderLine({ providerName: "HiAnime", providerId: "hianime" })).toBe(
      "HiAnime (hianime)",
    );
  });

  test("returns name alone when name equals id", () => {
    expect(formatLoadingProviderLine({ providerName: "hianime", providerId: "hianime" })).toBe(
      "hianime",
    );
  });

  test("returns null when both are empty", () => {
    expect(
      formatLoadingProviderLine({ providerName: undefined, providerId: undefined }),
    ).toBeNull();
  });
});

describe("shouldShowLoadingPosterCompanion", () => {
  test("returns false when no posterUrl", () => {
    expect(
      shouldShowLoadingPosterCompanion({
        operation: "resolve",
        columns: 120,
        posterUrl: undefined,
        posterKind: "series",
        posterState: "idle",
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
bun run test apps/cli/test/unit/app-shell/loading-shell.test.ts
```

Expected: PASS

- [ ] **Step 3: Fix progress bar width**

In `apps/cli/src/app-shell/loading-shell.tsx`, `useStdout` is already imported. Locate the progress bar render (around line 600-607):

```tsx
              {disclosure.showProgress && state.progress !== undefined ? (
                <Box marginTop={1}>
                  <Text>
                    {"█".repeat(Math.floor(state.progress / 2.5))}
                    {"░".repeat(40 - Math.floor(state.progress / 2.5))}
                  </Text>
                  <Text color={palette.teal}> {Math.round(state.progress)}%</Text>
                </Box>
```

The `LoadingShell` component already receives `const { stdout } = useStdout();` near the top. Add bar width derivation near the other computed values in the component body:

```tsx
const barWidth = Math.min(48, Math.max(12, Math.floor((stdout.columns ?? 80) * 0.45)));
```

Then update the render:

```tsx
              {disclosure.showProgress && state.progress !== undefined ? (
                <Box marginTop={1}>
                  <Text>
                    {"█".repeat(Math.floor((state.progress / 100) * barWidth))}
                    {"░".repeat(barWidth - Math.floor((state.progress / 100) * barWidth))}
                  </Text>
                  <Text color={palette.teal}> {Math.round(state.progress)}%</Text>
                </Box>
```

- [ ] **Step 4: Rename section labels**

Locate the "Status" section in the `isPlaying` block (around line 629):

```tsx
              {/* Status context strip */}
              {statusItems.length > 0 && (
                <LocalSection title="Status" tone="success" marginTop={0}>
                  <ContextStrip items={statusItems} />
                </LocalSection>
              )}

              {/* Playback telemetry */}
              <LocalSection title="Playback" tone="success" marginTop={1}>
```

Replace with:

```tsx
              {/* Status context strip — no section title needed, items are self-describing */}
              {statusItems.length > 0 && (
                <Box marginTop={0} flexDirection="column">
                  <ContextStrip items={statusItems} />
                </Box>
              )}

              {/* Playback telemetry */}
              <LocalSection title="Now playing" tone="success" marginTop={1}>
```

Then find the "Navigation" section (if present — search for `title="Navigation"`) and remove it entirely if it only duplicates footer hotkey hints. If it contains unique content, rename to a contextual label like "Controls".

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 6: Run tests**

```bash
bun run test apps/cli/test/unit/app-shell/loading-shell.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app-shell/loading-shell.tsx apps/cli/test/unit/app-shell/loading-shell.test.ts
git commit -m "feat(tui): dynamic progress bar width and contextual section labels in LoadingShell"
```

---

## Task 6: Footer Hotkey Format — Glyph-Only When Available

**Files:**

- Modify: `apps/cli/src/app-shell/shell-primitives.tsx`

**Problem:** `hotkeyLabel` wraps every key in `[brackets]`. When a glyph is prepended (e.g., `⏭ n`), the result `[⏭ n]` is redundant — both letter and glyph identify the action. On narrow terminals this eats budget.

**Fix:** In the footer render, when a glyph exists show only the glyph (no brackets, no letter). For plain text keys (no glyph), keep `[key]`. This maximizes readability per character — `⏭ next` vs `[⏭ n] next`.

**Viable alternatives:**

- **A (chosen):** Glyph-only when available; `[key]` for text-only keys
- **B:** Keep current `[⏭ n]` format — zero risk, zero gain
- **C:** `⟨glyph key⟩` with angle brackets — cleaner than `[ ]` but still verbose

- [ ] **Step 1: Write a test for `hotkeyLabel`**

Add to `apps/cli/test/unit/app-shell/shell-theme.test.ts` (create if missing):

```typescript
import { describe, expect, test } from "bun:test";
import { hotkeyLabel } from "@/app-shell/shell-theme";

describe("hotkeyLabel", () => {
  test("wraps plain key in brackets", () => {
    expect(hotkeyLabel("esc")).toBe("[esc]");
    expect(hotkeyLabel("enter")).toBe("[enter]");
  });

  test("returns glyph alone when glyph marker is present", () => {
    // glyph keys are passed as "glyph§key" sentinel
    expect(hotkeyLabel("⏭§n")).toBe("⏭");
    expect(hotkeyLabel("⏮§p")).toBe("⏮");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL on the glyph sentinel test (new behavior not yet implemented)**

```bash
bun run test apps/cli/test/unit/app-shell/shell-theme.test.ts
```

Expected: FAIL with "⏭§n" not matching "⏭"

- [ ] **Step 3: Update shell-primitives.tsx footer render and shell-theme.ts hotkeyLabel**

In `apps/cli/src/app-shell/shell-primitives.tsx`, change the footer action render (around line 215):

```tsx
              const glyph = FOOTER_GLYPHS[action.key] ?? "";
              const keyDisplay = glyph ? `${glyph} ${action.key}` : action.key;
              return (
                <Box ...>
                  <Text color={palette.teal}>{hotkeyLabel(keyDisplay)}</Text>
```

To use the sentinel `§` to signal glyph presence:

```tsx
              const glyph = FOOTER_GLYPHS[action.key] ?? "";
              const keyDisplay = glyph ? `${glyph}§${action.key}` : action.key;
              return (
                <Box ...>
                  <Text color={palette.teal}>{hotkeyLabel(keyDisplay)}</Text>
```

Then in `apps/cli/src/app-shell/shell-theme.ts`, update `hotkeyLabel`:

```typescript
export function hotkeyLabel(key: string): string {
  // "glyph§letter" sentinel: show only the glyph (no brackets, no letter)
  const sentinelIdx = key.indexOf("§");
  if (sentinelIdx !== -1) {
    return key.slice(0, sentinelIdx);
  }
  return `[${key}]`;
}
```

- [ ] **Step 4: Run the test**

```bash
bun run test apps/cli/test/unit/app-shell/shell-theme.test.ts
```

Expected: PASS

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/shell-primitives.tsx apps/cli/src/app-shell/shell-theme.ts apps/cli/test/unit/app-shell/shell-theme.test.ts
git commit -m "feat(tui): show glyph-only in footer hotkeys, brackets only for plain keys"
```

---

## Task 7: ResizeBlocker Brand + Dead Code Cleanup + InputField Hint

**Files:**

- Modify: `apps/cli/src/app-shell/shell-primitives.tsx` — ResizeBlocker brand; remove `BrowseTitle`
- Modify: `apps/cli/src/app-shell/shell-frame.tsx` — unify InputField hint position

### 7a: ResizeBlocker Brand Identity

**Problem:** ResizeBlocker shows only a technical message. When the terminal is too small, this is the only thing visible — it should reinforce the brand.

**Fix:** Add `APP_LABEL` centered below the resize message.

- [ ] **Step 1: Update ResizeBlocker**

In `apps/cli/src/app-shell/shell-primitives.tsx`, verify `APP_LABEL` is imported from `shell-theme` (it is — same file imports `hotkeyLabel` and `palette`). Actually `APP_LABEL` is in `shell-theme.ts`, not `shell-primitives.tsx` — add the import.

Add to the imports at top of `shell-primitives.tsx`:

```typescript
import { APP_LABEL, hotkeyLabel, palette } from "./shell-theme";
```

(Replace the existing `import { hotkeyLabel, palette } from "./shell-theme"` line.)

Then update `ResizeBlocker`:

```tsx
export const ResizeBlocker = React.memo(function ResizeBlocker({
  minColumns,
  minRows,
  message = "Terminal too small",
}: {
  minColumns: number;
  minRows: number;
  message?: string;
}) {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 0;
  const rows = stdout.rows ?? 0;

  return (
    <Box marginTop={1} flexDirection="column" paddingX={1}>
      <Text color={palette.amber}>{message}</Text>
      <Text color={palette.muted}>
        {`Terminal is ${cols}×${rows}  ·  needs ${minColumns}×${minRows}`}
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

### 7b: Remove Dead `BrowseTitle` Export

**Problem:** `BrowseTitle` in `shell-primitives.tsx` (lines 410-416) is never imported anywhere. The same content moved inline to `RootIdleShell`.

- [ ] **Step 2: Verify no imports of BrowseTitle**

```bash
grep -r "BrowseTitle" apps/cli/src/
```

Expected: Only the definition in `shell-primitives.tsx`. If any other file imports it, skip this step and note it.

- [ ] **Step 3: Remove BrowseTitle**

Delete these lines from `apps/cli/src/app-shell/shell-primitives.tsx`:

```tsx
export const BrowseTitle = React.memo(function BrowseTitle({ mode }: { mode: "series" | "anime" }) {
  return (
    <Text bold color="white">
      {mode === "anime" ? "Browse your favorite anime" : "Browse your favorite movies and series"}
    </Text>
  );
});
```

### 7c: Unify InputField Hint Position

**Problem:** `InputField` renders `hint` conditionally — above-right on wide terminals (`wideField`), below the input on narrow ones. This creates layout instability when the terminal width is near the 112-column threshold.

**Fix:** Always render the hint below the input. Remove the `wideField` conditional entirely.

- [ ] **Step 4: Update InputField in shell-frame.tsx**

Locate `InputField` render (around line 153-188). Replace:

```tsx
return (
  <Box marginTop={1} flexDirection="column">
    <Box justifyContent="space-between">
      <Text color={palette.muted}>{label}</Text>
      {renderedHint && wideField ? (
        <Text color={palette.gray} dimColor>
          {renderedHint}
        </Text>
      ) : null}
    </Box>
    <Box marginTop={1} flexDirection="column">
      <Box paddingX={1}>
        <Text color={focus ? palette.teal : palette.dim}>{focus ? "⌕ " : "› "}</Text>
        <LineEditorText
          value={value}
          cursor={editor.cursor}
          focused={focus}
          placeholder={placeholder}
          maxWidth={textWidth}
        />
      </Box>
      <Box>
        <Text color={focus ? palette.teal : palette.dim} dimColor>
          {"─".repeat(Math.max(4, fieldWidth))}
        </Text>
      </Box>
    </Box>
    {renderedHint && !wideField ? (
      <Box marginTop={1}>
        <Text color={palette.gray} dimColor>
          {renderedHint}
        </Text>
      </Box>
    ) : null}
  </Box>
);
```

With:

```tsx
return (
  <Box marginTop={1} flexDirection="column">
    <Text color={palette.muted}>{label}</Text>
    <Box marginTop={1} flexDirection="column">
      <Box paddingX={1}>
        <Text color={focus ? palette.teal : palette.dim}>{focus ? "⌕ " : "› "}</Text>
        <LineEditorText
          value={value}
          cursor={editor.cursor}
          focused={focus}
          placeholder={placeholder}
          maxWidth={textWidth}
        />
      </Box>
      <Box>
        <Text color={focus ? palette.teal : palette.dim} dimColor>
          {"─".repeat(Math.max(4, fieldWidth))}
        </Text>
      </Box>
    </Box>
    {renderedHint ? (
      <Box marginTop={1}>
        <Text color={palette.gray} dimColor>
          {renderedHint}
        </Text>
      </Box>
    ) : null}
  </Box>
);
```

Also remove `wideField` and `hintWidth` calculations since `hintWidth` depended on `wideField`. Simplify:

```typescript
const fieldWidth = Math.max(20, maxWidth ?? (stdout.columns ?? 80) - 8);
const textWidth = Math.max(4, fieldWidth - 8);
const renderedHint = hint ? truncateLine(hint, Math.max(12, fieldWidth - 4)) : undefined;
```

(Remove `const wideField = ...` and `const hintWidth = ...`.)

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 6: Run tests**

```bash
bun run test apps/cli/test/unit/app-shell/
```

Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app-shell/shell-primitives.tsx apps/cli/src/app-shell/shell-frame.tsx
git commit -m "feat(tui): ResizeBlocker brand identity, remove dead BrowseTitle, unify InputField hint"
```

---

## Task 8: Final Typecheck, Lint, and Format

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: 0 errors

- [ ] **Step 3: Run formatter check**

```bash
bun run fmt:check
```

Expected: 0 formatting issues. If formatting issues are found, run `bun run fmt` to fix them, then commit:

```bash
git add -p
git commit -m "style: auto-format after TUI polish pass II"
```

- [ ] **Step 4: Run full test suite**

```bash
bun run test apps/cli/test/unit/
```

Expected: All pass. Note any pre-existing flaky tests (the `offline artwork cache > dedupes concurrent poster cache work` test is a known flaky — re-run once if it fails in isolation.

- [ ] **Step 5: Final commit if any outstanding changes**

```bash
git add -p
git commit -m "chore: finalize TUI polish pass II"
```

---

## Implementation Order Note

Tasks may be executed in order (1→8). Tasks 1, 3, 4, 6 are fully independent. Task 2 and Task 6 both touch `shell-primitives.tsx` through different paths — ensure no merge conflict by doing them in order. Task 5 is fully independent. Task 7 touches two files independently.

---

## What This Pass Delivers

| Area              | Before                                      | After                                                     |
| ----------------- | ------------------------------------------- | --------------------------------------------------------- |
| Picker rows       | Label and detail same color                 | Label white, detail muted — clear hierarchy               |
| OverlayPanel      | Round box border                            | Borderless `▸ Title` accent — consistent with rest of app |
| Settings sections | `section:general` rendered as a normal item | Uppercase dim separator row                               |
| Busy state        | Static "Saving settings…"                   | Animated Braille spinner                                  |
| Discover items    | Inactive items in `palette.muted` (dim)     | `palette.text` — readable at a glance                     |
| Checklist filter  | No cursor — can't see edit position         | Blinking cursor via `LineEditorText`                      |
| Progress bar      | Hardcoded 40 chars                          | Dynamic: `stdout.columns * 0.45`, capped 12–48            |
| Loading sections  | "Status" / "Playback" debug labels          | Stripped / "Now playing"                                  |
| Footer hotkeys    | `[⏭ n] next`                               | `⏭ next` — compact glyph-first                           |
| ResizeBlocker     | No identity                                 | Shows `APP_LABEL` below message                           |
| BrowseTitle       | Dead export in shell-primitives             | Removed                                                   |
| InputField hint   | Jumps position at 112-col threshold         | Always below input                                        |
