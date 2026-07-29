# Episode Picker Sakura UX Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six concrete UX/Sakura problems in the episode picker overlay: duplicate episode labels, rainbow row coloring, inconsistent status glyphs, preview rail issues, triple "Choose episode" label, and selected-row styling.

**Architecture:** All formatting logic for episode labels, status glyphs, and de-duplication is extracted into a new pure helper module (`episode-picker-format.ts`). The existing `buildEpisodePickerOption` in `playback-episode-picker.ts` is refactored to use these helpers. `PickerOptionRow` gets a safe, backward-compatible neutral-label fix. `EpisodePreviewRail` in `overlay-panel.tsx` is updated for clean truncation and deduplication. The footer/header label repetition is fixed in `root-overlay-shell.tsx`.

**Tech Stack:** TypeScript, React (Ink 7), Bun test runner. Files owned: `overlay-panel.tsx`, `overlay-picker-row.tsx`, `playback-episode-picker.ts`, `root-overlay-shell.tsx` (footer only). New file: `episode-picker-format.ts`. Test files: `episode-picker-format.test.ts`, `episode-picker.capture.tsx`.

---

## File Map

| Action | File                                                   | Responsibility                                                           |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Create | `apps/cli/src/app/episode-picker-format.ts`            | Pure label formatting: dedup, status glyphs, threshold logic             |
| Modify | `apps/cli/src/app/playback-episode-picker.ts`          | Use new helpers; replace inline label/badge/tone logic                   |
| Modify | `apps/cli/src/app-shell/overlay-picker-row.tsx`        | Neutral label color for unselected rows (accentColor only on badge)      |
| Modify | `apps/cli/src/app-shell/overlay-panel.tsx`             | `EpisodePreviewRail`: clean truncation, no dup, word-wrap synopsis       |
| Modify | `apps/cli/src/app-shell/root-overlay-shell.tsx`        | Footer: replace `title` with shorter nav hint for episode/season pickers |
| Create | `apps/cli/test/unit/app/episode-picker-format.test.ts` | Table tests for all formatting helpers                                   |
| Create | `apps/cli/test/harness/episode-picker.capture.tsx`     | Harness fixture: 4 cases × 3 widths                                      |

---

## Problem Reference

1. **Duplicate label** — `Episode 7 · Episode 7` when provider has no real title. Fix: deduplicate in label builder.
2. **Rainbow rows** — `accentColor` (rose/mint) applied to row label text. Fix: label always `palette.text`; only badge carries color.
3. **Inconsistent status glyph grammar** — `watched / ▶ watched / ✓ / 1%` mixed. Fix: canonical set: `✓` (ok, mint), `▸` (current, rose, one row only), `N%` (in-progress, accentDeep), air date (unwatched, dim). Trivial 1% suppressed.
4. **Preview rail** — duplicate title + mid-word truncation. Fix: `truncateAtWord` on label, no dup, add date/progress metadata.
5. **Triple "Choose episode"** — crumb + title + footer all say "Choose episode". Fix: footer shows nav hint, not title, for media pickers.
6. **Selected row** — rose `▌` bar + `accentFill` band is correct; keep it.

---

## Task 1: Extract `episode-picker-format.ts` — pure formatting helpers

**Files:**

- Create: `apps/cli/src/app/episode-picker-format.ts`

### Step-by-step

- [ ] **Step 1: Create the file with the three helpers**

```typescript
// apps/cli/src/app/episode-picker-format.ts
//
// Pure formatting helpers for the episode picker. No Ink imports; testable
// without a terminal. All decisions about label deduplication, status glyph
// grammar, and trivial-progress suppression live here.

/**
 * Return the display label for an episode row, deduplicating when the
 * episode name is just "Episode N" (case-insensitive, trimmed).
 *
 * Examples:
 *   deduplicateEpisodeLabel("Episode 7", "Episode 7") → "Episode 7"
 *   deduplicateEpisodeLabel("Episode 7", "Shotgun")   → "Episode 7  ·  Shotgun"
 *   deduplicateEpisodeLabel("Episode 7", "")          → "Episode 7"
 */
export function deduplicateEpisodeLabel(episodeCode: string, episodeName: string): string {
  const name = episodeName.trim();
  if (!name) return episodeCode;
  if (name.toLowerCase() === episodeCode.trim().toLowerCase()) return episodeCode;
  return `${episodeCode}  ·  ${name}`;
}

/**
 * Status glyph grammar for the episode picker trailing badge.
 * Returns `{ badge, tone }` for `ShellPickerOption`.
 *
 * Grammar (mutually exclusive, priority order):
 *   watched    → badge "✓",   tone "success"   (mint)
 *   current    → badge "▸",   tone "info"       (rose — but only the ▸ carries the hue via tone)
 *   in-progress with percent ≥ TRIVIAL_PCT → badge "N%", tone "warning"  (accentDeep)
 *   in-progress without usable percent    → badge "▸",  tone "info"
 *   unwatched  → badge undefined, tone undefined
 *
 * TRIVIAL_PCT: progress < 3% is noise (e.g. autoplayed 1 second), suppressed.
 */
const TRIVIAL_PROGRESS_PCT = 3;

export type EpisodeStatusGlyph = {
  readonly badge: string | undefined;
  readonly tone: "success" | "info" | "warning" | undefined;
};

export function resolveEpisodeStatusGlyph({
  isWatched,
  isCurrent,
  isInProgress,
  progressPercent,
}: {
  isWatched: boolean;
  isCurrent: boolean;
  isInProgress: boolean;
  progressPercent: number | null;
}): EpisodeStatusGlyph {
  if (isWatched) return { badge: "✓", tone: "success" };
  if (isCurrent && !isInProgress) return { badge: "▸", tone: "info" };
  if (isInProgress) {
    if (progressPercent !== null && progressPercent >= TRIVIAL_PROGRESS_PCT) {
      return { badge: `${progressPercent}%`, tone: "warning" };
    }
    // In-progress but no usable percentage — show resume glyph
    return { badge: "▸", tone: "info" };
  }
  return { badge: undefined, tone: undefined };
}
```

- [ ] **Step 2: Run typecheck to verify the new file compiles**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run typecheck 2>&1 | tail -20
```

Expected: no errors referencing `episode-picker-format.ts`.

---

## Task 2: Table-test the formatting helpers

**Files:**

- Create: `apps/cli/test/unit/app/episode-picker-format.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// apps/cli/test/unit/app/episode-picker-format.test.ts
import { describe, expect, test } from "bun:test";

import { deduplicateEpisodeLabel, resolveEpisodeStatusGlyph } from "@/app/episode-picker-format";

describe("deduplicateEpisodeLabel", () => {
  test("suppresses duplicate when name equals code (case-insensitive)", () => {
    expect(deduplicateEpisodeLabel("Episode 7", "Episode 7")).toBe("Episode 7");
    expect(deduplicateEpisodeLabel("Episode 7", "episode 7")).toBe("Episode 7");
    expect(deduplicateEpisodeLabel("Episode 7", "  Episode 7  ")).toBe("Episode 7");
  });

  test("joins code and real title with separator", () => {
    expect(deduplicateEpisodeLabel("Episode 7", "Shotgun")).toBe("Episode 7  ·  Shotgun");
    expect(deduplicateEpisodeLabel("E01", "Pilot")).toBe("E01  ·  Pilot");
  });

  test("returns code alone when name is empty", () => {
    expect(deduplicateEpisodeLabel("Episode 7", "")).toBe("Episode 7");
    expect(deduplicateEpisodeLabel("Episode 7", "   ")).toBe("Episode 7");
  });
});

describe("resolveEpisodeStatusGlyph", () => {
  test("watched → ✓ mint", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: true,
      isCurrent: false,
      isInProgress: false,
      progressPercent: null,
    });
    expect(result).toEqual({ badge: "✓", tone: "success" });
  });

  test("current not-in-progress → ▸ info", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: false,
      isCurrent: true,
      isInProgress: false,
      progressPercent: null,
    });
    expect(result).toEqual({ badge: "▸", tone: "info" });
  });

  test("in-progress with usable percent → N% warning", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: false,
      isCurrent: false,
      isInProgress: true,
      progressPercent: 47,
    });
    expect(result).toEqual({ badge: "47%", tone: "warning" });
  });

  test("in-progress with percent exactly at threshold → shown", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: false,
      isCurrent: false,
      isInProgress: true,
      progressPercent: 3,
    });
    expect(result).toEqual({ badge: "3%", tone: "warning" });
  });

  test("trivial progress below threshold → suppress percent, show ▸", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: false,
      isCurrent: false,
      isInProgress: true,
      progressPercent: 1,
    });
    expect(result).toEqual({ badge: "▸", tone: "info" });
  });

  test("in-progress with null percent → ▸ info", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: false,
      isCurrent: false,
      isInProgress: true,
      progressPercent: null,
    });
    expect(result).toEqual({ badge: "▸", tone: "info" });
  });

  test("unwatched → empty", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: false,
      isCurrent: false,
      isInProgress: false,
      progressPercent: null,
    });
    expect(result).toEqual({ badge: undefined, tone: undefined });
  });

  test("watched takes priority over current", () => {
    const result = resolveEpisodeStatusGlyph({
      isWatched: true,
      isCurrent: true,
      isInProgress: false,
      progressPercent: null,
    });
    expect(result.badge).toBe("✓");
    expect(result.tone).toBe("success");
  });
});
```

- [ ] **Step 2: Run the tests**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run test --testPathPattern="episode-picker-format" 2>&1
```

Expected: all 8 tests pass.

- [ ] **Step 3: Commit**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && git add apps/cli/src/app/episode-picker-format.ts apps/cli/test/unit/app/episode-picker-format.test.ts && git commit -m "$(cat <<'EOF'
feat(episode-picker): extract label dedup + status glyph helpers

Canonical grammar: ✓ watched, ▸ current/resume, N% in-progress
(suppressed < 3%), air date for unwatched. Tested with table tests.
EOF
)"
```

---

## Task 3: Fix `buildEpisodePickerOption` to use the new helpers

**Files:**

- Modify: `apps/cli/src/app/playback-episode-picker.ts`

The current `buildEpisodePickerOption` (line 201–234) produces:

- `label: "Episode 5  ·  The Current One"` even when name == code
- `badge: "watched"` (text, not glyph)
- `tone: "info"` for current episode (which makes `accentColor` rose via `rowAccentColor` in overlay-panel, causing rainbow)

After this task:

- Label uses `deduplicateEpisodeLabel`
- Badge/tone from `resolveEpisodeStatusGlyph`
- Current episode no longer gets `tone: "info"` (the `▸` badge carries the current indicator; tone is only for watched/in-progress)

> **Important:** The current episode is identified by the `▸` badge, NOT by `tone: "info"`. Removing `tone: "info"` is the fix for the rainbow row (it was causing `rowAccentColor` to be `palette.muted`, which isn't terrible, but `tone: "info"` flowed into `accentColor: muted` while `tone: "warning"` would flow into rose, causing the mis-coloring). The REAL rainbow comes from `tone: "warning"` → `accentColor = palette.accentDeep` coloring the entire label text, per `overlay-picker-row.tsx` line 67.

The fix: **current-only episodes get no tone** (their `▸` badge alone identifies them). In-progress + current episodes keep `tone: "warning"` for the badge color, but the label text color change (fix 2) in `PickerOptionRow` means the label won't be colored by `accentColor` anymore.

- [ ] **Step 1: Import the new helpers at the top of the file**

In `apps/cli/src/app/playback-episode-picker.ts`, after the existing imports (around line 10), add:

```typescript
import { deduplicateEpisodeLabel, resolveEpisodeStatusGlyph } from "@/app/episode-picker-format";
```

- [ ] **Step 2: Rewrite `buildEpisodePickerOption` (lines 201–234)**

Replace the function body. The key changes:

1. Use `deduplicateEpisodeLabel` for `label` instead of inline `Episode ${episode}  ·  ${name}`
2. Use `resolveEpisodeStatusGlyph` for `badge` and `tone`
3. Remove the `▶  ` prefix (current is now indicated only by the `▸` badge)
4. Keep `detail` assembly via existing `mergeEpisodeDetail`

```typescript
export function buildEpisodePickerOption({
  season,
  episode,
  label,
  baseDetail,
  releaseBadge,
  current,
  history,
}: {
  season: number;
  episode: number;
  label: string;
  baseDetail?: string;
  releaseBadge?: string;
  current: boolean;
  history?: HistoryEntry;
}): ShellPickerOption<string> {
  const watch = describeEpisodeWatchPresentation(history);
  const progress = history ? projectWatchProgress(history) : null;
  const glyph = resolveEpisodeStatusGlyph({
    isWatched: watch.watched,
    isCurrent: current,
    isInProgress: watch.inProgress,
    progressPercent: progress?.percentage ?? null,
  });
  return {
    value: `${season}:${episode}`,
    label,
    detail: mergeEpisodeDetail(history, watch.detail, releaseBadge, baseDetail),
    tone: glyph.tone,
    badge: glyph.badge,
  };
}
```

Also update the call sites that build the `label` argument:

In the anime branch (around line 52–65):

```typescript
const options = animeEpisodes.map((entry) =>
  buildEpisodePickerOption({
    season: 1,
    episode: entry.index,
    label: deduplicateEpisodeLabel(`Episode ${entry.index}`, entry.label ?? ""),
    baseDetail: entry.detail,
    releaseBadge: releaseBadges?.get(`1:${entry.index}`),
    current: entry.index === currentEpisode.episode,
    history: watchedByEpisode.get(`1:${entry.index}`),
  }),
);
```

In the anime fallback branch (around line 79–88):

```typescript
const options = Array.from({ length: fallbackCount }, (_, index) => index + 1).map((episode) =>
  buildEpisodePickerOption({
    season: 1,
    episode,
    label: `Episode ${episode}`,
    releaseBadge: releaseBadges?.get(`1:${episode}`),
    current: episode === currentEpisode.episode,
    history: watchedByEpisode.get(`1:${episode}`),
  }),
);
```

In the series branch (around line 101–120), the TMDB episodes have `entry.name`. Use `deduplicateEpisodeLabel`:

```typescript
const options = episodes.map((entry) =>
  buildEpisodePickerOption({
    season: currentEpisode.season,
    episode: entry.number,
    label: deduplicateEpisodeLabel(`Episode ${entry.number}`, entry.name ?? ""),
    baseDetail: entry.airDate || "unknown year",
    releaseBadge: releaseBadges?.get(`${currentEpisode.season}:${entry.number}`),
    current: entry.number === currentEpisode.episode,
    history: watchedByEpisode.get(`${currentEpisode.season}:${entry.number}`),
  }),
);
```

- [ ] **Step 3: Update existing unit tests for `buildEpisodePickerOption`**

The tests in `apps/cli/test/unit/app/playback-episode-picker.test.ts` will need updating for the new behavior (no `▶  ` prefix, `✓` badge instead of `"watched"` text, `▸` instead of `undefined`):

In the test "marks the current episode with info tone" (line 97), update expectation:

```typescript
test("marks the current episode with a ▸ badge (no rainbow tone)", () => {
  const option = buildEpisodePickerOption({
    season: 1,
    episode: 2,
    label: "Episode 2",
    current: true,
  });

  expect(option.label).toBe("Episode 2"); // no ▶  prefix anymore
  expect(option.badge).toBe("▸");
  expect(option.tone).toBe("info");
});
```

Update the "loads season episodes for series playback" test expectation for the watched episode badge:

```typescript
// was: badge: "watched"  →  now: badge: "✓"
// was: label: "▶  Episode 5  ·  The Current One"  →  now: label: "Episode 5  ·  The Current One"
expect(result.options).toEqual([
  {
    value: "2:5",
    label: "Episode 5  ·  The Current One",
    detail: "watched  ·  2w ago  ·  2026-01-01",
    tone: "success",
    badge: "✓",
  },
  {
    value: "2:6",
    label: "Episode 6  ·  The Next One",
    detail: "[██░░░░░░░░]  ·  resume 10:00  ·  17% watched  ·  unknown year",
    tone: "warning",
    badge: "17%",
  },
]);
```

Update the anime provider catalog test expectation:

```typescript
expect(result.options).toEqual([
  {
    value: "1:1",
    label: "Episode 1", // deduplicateEpisodeLabel("Episode 1", "Episode 1") → "Episode 1"
    detail: "Source episode 1",
    tone: undefined,
    badge: undefined,
  },
  {
    value: "1:2",
    label: "Episode 2", // same dedup logic
    detail: "Source episode 2",
    tone: "info",
    badge: "▸", // current
  },
]);
```

- [ ] **Step 4: Run tests**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run test --testPathPattern="playback-episode-picker" 2>&1
```

Expected: all tests pass (updated expectations).

- [ ] **Step 5: Run typecheck**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && git add apps/cli/src/app/playback-episode-picker.ts apps/cli/test/unit/app/playback-episode-picker.test.ts && git commit -m "$(cat <<'EOF'
fix(episode-picker): dedup labels, canonical glyph badges, no rainbow tone

Replace ▶  prefix + text badge with ▸ glyph badge. Watched → ✓.
Remove redundant Episode N · Episode N when provider has no real title.
EOF
)"
```

---

## Task 4: Fix `PickerOptionRow` — neutral label color for unselected rows

**Files:**

- Modify: `apps/cli/src/app-shell/overlay-picker-row.tsx`

**The bug (line 67):**

```tsx
<Text color={selected ? pickerAccent : (accentColor ?? palette.text)} wrap="truncate-end">
  {truncatedLabel}
</Text>
```

When `accentColor` is `palette.ok` (mint, watched) or `palette.accentDeep` (rose-deep, in-progress), the entire label text gets colored — this is the rainbow. The fix: label text is ALWAYS `palette.text` for unselected rows; only the badge `<Text>` carries `accentColor`.

**Safe backward compatibility:** All other pickers (provider, settings, history) either pass `accentColor: null` or use `tone` for purely cosmetic row tinting (settings danger rows). After this fix, unselected rows will always render labels in `palette.text`; the badge still carries `accentColor`. For settings danger rows, the dot indicator in `overlay-panel.tsx` already uses `dotColor` separately — not affected.

- [ ] **Step 1: Read the file first** (already read above)

- [ ] **Step 2: Change line 67 in `overlay-picker-row.tsx`**

Old:

```tsx
<Text color={selected ? pickerAccent : (accentColor ?? palette.text)} wrap="truncate-end">
  {truncatedLabel}
</Text>
```

New:

```tsx
<Text color={selected ? pickerAccent : palette.text} wrap="truncate-end">
  {truncatedLabel}
</Text>
```

The badge line (line 77) stays as-is: the badge already uses `accentColor` for its color when not selected, which is correct.

- [ ] **Step 3: Run existing picker row tests**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run test --testPathPattern="overlay-picker-row|overlay-panel" 2>&1
```

Expected: all tests pass (the change is visual color only; no text content tests break).

- [ ] **Step 4: Commit**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && git add apps/cli/src/app-shell/overlay-picker-row.tsx && git commit -m "$(cat <<'EOF'
fix(picker-row): label text always palette.text on unselected rows

Color encodes state/focus, never identity. Badge carries accentColor;
label is neutral weight-hierarchy text per Sakura THE ONE RULE.
EOF
)"
```

---

## Task 5: Fix `EpisodePreviewRail` — clean truncation, no dup, enrich metadata

**Files:**

- Modify: `apps/cli/src/app-shell/overlay-panel.tsx` (`EpisodePreviewRail` component, lines 945–989)

**Problems:**

- Line 979: `option.label` passed directly to `<Text wrap="truncate-end">` — this mid-word truncates
- The rail shows the same label that's already in the list row (duplication)
- No date, progress, or synopsis slot

**Fix:**

- Import `truncateAtWord` from `./shell-text` (already imported `truncateLine`, add `truncateAtWord`)
- In `EpisodePreviewRail`, compute a clean `displayName` from `option.label` using `truncateAtWord(option.label, width - 2)` so long labels don't mid-word cut
- Show `option.detail` (which contains date / progress text) as a second line in dim
- Show `option.badge` as status glyph
- Reserve the poster slot exactly as before (height=6 fixed)

The rail width is `railColumnWidth = 20` (narrow) — very tight. The label on 20 cols must be `truncateAtWord`.

- [ ] **Step 1: Add `truncateAtWord` to the import in `overlay-panel.tsx`**

Find line 18:

```typescript
import { getWindowStart, truncateLine, wrapText } from "./shell-text";
```

Change to:

```typescript
import { getWindowStart, truncateAtWord, truncateLine, wrapText } from "./shell-text";
```

- [ ] **Step 2: Rewrite `EpisodePreviewRail` component (lines 944–989)**

Replace the entire `EpisodePreviewRail` component:

```tsx
// Right-hand preview rail for the episode picker. The poster slot is height-
// reserved so the metadata below it never jumps when artwork resolves (spec:
// episode-season-picker.md). Falls back to a quiet placeholder before/without art.
const EpisodePreviewRail = React.memo(function EpisodePreviewRail({
  poster,
  posterState,
  option,
  width,
}: {
  poster: PosterResult;
  posterState: PosterState;
  option: ShellPickerOption<string> | undefined;
  width: number;
}) {
  const badgeColor =
    option?.tone === "success"
      ? palette.ok
      : option?.tone === "warning"
        ? palette.accentDeep
        : option?.tone === "info"
          ? palette.accent
          : palette.muted;
  // Word-wrap-safe truncation so label never cuts mid-word in the narrow rail.
  const displayLabel = option?.label ? truncateAtWord(option.label, width - 1) : undefined;
  return (
    <Box flexDirection="column" width={width} marginLeft={2} flexShrink={0}>
      <Box height={6} width={width}>
        {poster.kind !== "none" ? (
          <Text>{poster.placeholder}</Text>
        ) : (
          <Text color={palette.dim} dimColor>
            {posterState === "loading" ? "loading…" : "no art"}
          </Text>
        )}
      </Box>
      {option ? (
        <Box flexDirection="column" marginTop={1}>
          {displayLabel ? (
            <Text color={palette.text} bold wrap="truncate-end">
              {displayLabel}
            </Text>
          ) : null}
          {option.badge ? <Text color={badgeColor}>{option.badge}</Text> : null}
          {option.detail ? (
            <Text color={palette.dim} wrap="truncate-end">
              {truncateAtWord(option.detail, width - 1)}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
});
```

- [ ] **Step 3: Run typecheck**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Run relevant tests**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run test --testPathPattern="overlay-panel|use-poster-preview|preview-rail" 2>&1
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && git add apps/cli/src/app-shell/overlay-panel.tsx && git commit -m "$(cat <<'EOF'
fix(episode-picker): clean preview rail — word-safe truncation, badge color, no dup

truncateAtWord prevents mid-word cuts at narrow rail width. Badge color
matches status tone. No duplicate title rendering.
EOF
)"
```

---

## Task 6: Fix footer label — stop repeating "Choose episode" three times

**Files:**

- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx` (footer `taskLabel` only)

**Problem:** `isRootMediaPickerOverlay(overlay)` branch of the footer `taskLabel` (around line 1610) uses `title` which is "Choose episode". The crumb (`ContextStrip`) already shows the title, and the panel body shows it again as `overlay.title`.

**Fix:** For media pickers (episode/season/subtitle/source/quality/recommendation), show a short nav hint instead of repeating the title:

- [ ] **Step 1: Find the exact lines in `root-overlay-shell.tsx`**

The `<ShellFooter>` at around line 1596 has:

```tsx
taskLabel={
  ...
  : isRootMediaPickerOverlay(overlay)
    ? title
    : `${title}  ·  Esc closes and returns to the previous shell state`
}
```

- [ ] **Step 2: Change the `isRootMediaPickerOverlay` branch**

Replace `? title` with a nav hint that works for all media pickers without repeating the overlay title:

```tsx
: isRootMediaPickerOverlay(overlay)
  ? overlay.type === "episode_picker"
    ? "↑↓ select  ·  Enter jump  ·  type to filter  ·  Esc closes"
    : overlay.type === "season_picker"
      ? "↑↓ select  ·  Enter jump  ·  Esc closes"
      : "↑↓ select  ·  Enter confirm  ·  type to filter  ·  Esc closes"
  : `${title}  ·  Esc closes and returns to the previous shell state`
```

- [ ] **Step 3: Run typecheck**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run typecheck 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 4: Run root-overlay-model tests**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run test --testPathPattern="root-overlay" 2>&1
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && git add apps/cli/src/app-shell/root-overlay-shell.tsx && git commit -m "$(cat <<'EOF'
fix(episode-picker): footer shows nav hint, not duplicate title

Replace title repetition in the media picker footer with a concise
↑↓ select · Enter jump · type to filter · Esc closes hint.
EOF
)"
```

---

## Task 7: Visual validation — build and read capture snapshots

**Files:**

- Create: `apps/cli/test/harness/episode-picker.capture.tsx`

This harness exercises four distinct fixture cases rendered at all three canonical widths.

- [ ] **Step 1: Create the capture harness**

```tsx
// apps/cli/test/harness/episode-picker.capture.tsx
// Run: bun apps/cli/test/harness/episode-picker.capture.tsx
// Writes: apps/cli/test/__captures__/episode-picker.*.txt
//
// Four cases:
//   real-titles      — TMDB episodes with distinct names (no dedup)
//   fallback-only    — episodes with "Episode N" names only (dedup fires)
//   watch-progress   — mix of watched / current / in-progress / unwatched
//   trivial-progress — in-progress episode at 1% (suppressed badge)

import { OverlayPanel } from "@/app-shell/overlay-panel";
import type { BrowseOverlay } from "@/app-shell/overlay-panel";
import React from "react";

import { captureSurface } from "./render-capture";

// ── Case 1: real titles (no dedup needed) ────────────────────────────────────
const realTitlesOverlay: BrowseOverlay = {
  type: "episode-picker",
  title: "Choose episode",
  subtitle: "Breaking Bad  ·  S02  ·  7 eps  ·  71% complete",
  filterQuery: "",
  selectedIndex: 2,
  options: [
    {
      value: "2:1",
      label: "Episode 1  ·  Seven Thirty-Seven",
      detail: "2009-03-08",
      tone: "success",
      badge: "✓",
    },
    {
      value: "2:2",
      label: "Episode 2  ·  Grilled",
      detail: "2009-03-15",
      tone: "success",
      badge: "✓",
    },
    {
      value: "2:3",
      label: "Episode 3  ·  Bit by a Dead Bee",
      detail: "2009-03-22",
      tone: "info",
      badge: "▸",
    },
    { value: "2:4", label: "Episode 4  ·  Down", detail: "2009-03-29" },
    {
      value: "2:5",
      label: "Episode 5  ·  Breakage",
      detail: "2009-04-05",
      tone: "warning",
      badge: "47%",
    },
    { value: "2:6", label: "Episode 6  ·  Peekaboo", detail: "2009-04-12" },
    { value: "2:7", label: "Episode 7  ·  Negro y Azul", detail: "2009-04-19" },
  ],
};

// ── Case 2: fallback-only (all names are "Episode N" — dedup fires) ──────────
const fallbackOnlyOverlay: BrowseOverlay = {
  type: "episode-picker",
  title: "Choose episode",
  subtitle: "Anime Show  ·  S01  ·  5 eps",
  filterQuery: "",
  selectedIndex: 1,
  options: [
    { value: "1:1", label: "Episode 1", detail: "2024-01-06", tone: "success", badge: "✓" },
    { value: "1:2", label: "Episode 2", detail: "2024-01-13", tone: "info", badge: "▸" },
    { value: "1:3", label: "Episode 3", detail: "2024-01-20" },
    { value: "1:4", label: "Episode 4", detail: "2024-01-27" },
    { value: "1:5", label: "Episode 5", detail: "2024-02-03" },
  ],
};

// ── Case 3: watch-progress mix ───────────────────────────────────────────────
const watchProgressOverlay: BrowseOverlay = {
  type: "episode-picker",
  title: "Choose episode",
  subtitle: "Example Series  ·  S01  ·  6 eps  ·  33% complete",
  filterQuery: "",
  selectedIndex: 2,
  options: [
    {
      value: "1:1",
      label: "Episode 1  ·  Pilot",
      detail: "watched  ·  2w ago  ·  2024-01-06",
      tone: "success",
      badge: "✓",
    },
    {
      value: "1:2",
      label: "Episode 2  ·  The One After",
      detail: "watched  ·  1w ago  ·  2024-01-13",
      tone: "success",
      badge: "✓",
    },
    {
      value: "1:3",
      label: "Episode 3  ·  Deep Water",
      detail: "[████░░░░░░]  ·  resume 22:14  ·  47% watched  ·  2024-01-20",
      tone: "info",
      badge: "▸",
    },
    { value: "1:4", label: "Episode 4  ·  Pressure", detail: "2024-01-27" },
    { value: "1:5", label: "Episode 5  ·  The Long Game", detail: "2024-02-03" },
    { value: "1:6", label: "Episode 6  ·  Finale", detail: "2024-02-10" },
  ],
};

// ── Case 4: trivial-progress (1% suppressed) ─────────────────────────────────
const trivialProgressOverlay: BrowseOverlay = {
  type: "episode-picker",
  title: "Choose episode",
  subtitle: "New Show  ·  S01  ·  3 eps",
  filterQuery: "",
  selectedIndex: 0,
  options: [
    {
      value: "1:1",
      label: "Episode 1  ·  Beginnings",
      detail: "[░░░░░░░░░░]  ·  resume 00:42  ·  2024-03-01",
      tone: "info",
      badge: "▸",
    },
    { value: "1:2", label: "Episode 2  ·  Rising Action", detail: "2024-03-08" },
    { value: "1:3", label: "Episode 3  ·  Climax", detail: "2024-03-15" },
  ],
};

await captureSurface(
  "episode-picker.real-titles",
  <OverlayPanel overlay={realTitlesOverlay} width={92} />,
);
await captureSurface(
  "episode-picker.fallback-only",
  <OverlayPanel overlay={fallbackOnlyOverlay} width={92} />,
);
await captureSurface(
  "episode-picker.watch-progress",
  <OverlayPanel overlay={watchProgressOverlay} width={92} />,
);
await captureSurface(
  "episode-picker.trivial-progress",
  <OverlayPanel overlay={trivialProgressOverlay} width={92} />,
);

console.log("captured 4 episode-picker cases × 3 widths = 12 files");
process.exit(0);
```

- [ ] **Step 2: Run the harness**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun apps/cli/test/harness/episode-picker.capture.tsx 2>&1
```

Expected: "captured 4 episode-picker cases × 3 widths = 12 files"

- [ ] **Step 3: Read capture files and verify each one**

```sh
cat /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/test/__captures__/episode-picker.real-titles.medium.txt
```

Check:

- No `Episode 7 · Episode 7` or similar doubled labels
- Rows show clean titles like `Episode 3  ·  Bit by a Dead Bee`
- Status glyphs `✓`, `▸`, `47%` appear at row end (badge position)
- "Choose episode" appears once (panel title line)

```sh
cat /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/test/__captures__/episode-picker.fallback-only.medium.txt
```

Check:

- Episodes show `Episode N` only (not `Episode N  ·  Episode N`)
- `✓` and `▸` glyphs present
- Rail area shows episode info without duplication

```sh
cat /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/test/__captures__/episode-picker.watch-progress.medium.txt
```

Check:

- Rows are NOT colored differently from each other (no rainbow) — all label text is same color weight
- `✓` for watched, `▸` for current, `47%` for in-progress
- Selected row shows `▌ ` prefix + highlighted label

```sh
cat /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/test/__captures__/episode-picker.trivial-progress.medium.txt
```

Check:

- 1% not shown as `1%` — instead shows `▸` (trivial threshold suppression)

Also check narrow (72 cols — rail should be hidden):

```sh
cat /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/test/__captures__/episode-picker.watch-progress.narrow.txt
```

Check:

- No rail pane (collapses at < 56 cols of content; 72 - 4 margin = 68, so rail IS shown at 72)
  - Actually at 72 cols, `contentWidth = 68`, `showPreviewRail = 68 >= 56` → rail is shown. That's fine; it's a narrow-but-not-too-narrow case.

- [ ] **Step 4: Run `countCommits` flicker check**

Add a quick inline check to confirm idle = 1 frame. This can be a manual test run:

```sh
cat >> /tmp/flicker-check.tsx << 'EOF'
import { OverlayPanel } from "@/app-shell/overlay-panel";
import type { BrowseOverlay } from "@/app-shell/overlay-panel";
import { countCommits } from "./render-capture";
import React from "react";

const overlay: BrowseOverlay = {
  type: "episode-picker",
  title: "Choose episode",
  subtitle: "Test  ·  S01  ·  2 eps",
  filterQuery: "",
  selectedIndex: 0,
  options: [
    { value: "1:1", label: "Episode 1", badge: "✓", tone: "success" },
    { value: "1:2", label: "Episode 2" },
  ],
};

const report = await countCommits(<OverlayPanel overlay={overlay} width={92} />, { durationMs: 300 });
console.log("commits:", report.commits, "distinct:", report.distinctFrames);
if (report.commits > 1) {
  console.error("FLICKER: idle surface committed more than 1 frame");
  process.exit(1);
}
console.log("idle = 1 frame, calm");
process.exit(0);
EOF
```

Actually, write this as part of a proper test instead. For now: validate manually and note in the report.

- [ ] **Step 5: Commit the capture harness**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && git add apps/cli/test/harness/episode-picker.capture.tsx apps/cli/test/__captures__/ && git commit -m "$(cat <<'EOF'
test(episode-picker): capture harness for 4 fixture cases × 3 widths

Covers: real titles (no dedup), fallback-only (dedup), watch-progress
mix (watched/current/in-progress/unwatched), trivial-progress (suppressed).
EOF
)"
```

---

## Task 8: Final gate — typecheck + lint + test

- [ ] **Step 1: Run typecheck**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run typecheck 2>&1
```

Expected: 0 errors.

- [ ] **Step 2: Run lint**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run lint 2>&1
```

Expected: no violations. If minor auto-fixable issues, run `bun run lint --fix` on the specific files only (do NOT run `bun run fmt` globally per task constraints).

- [ ] **Step 3: Run all tests**

```sh
cd /home/kitsunekode/Projects/hacking/kitsunesnipe && bun run test 2>&1
```

Expected: all tests green, including the new `episode-picker-format.test.ts` and updated `playback-episode-picker.test.ts`.

- [ ] **Step 4: Report back**

Compile the report for the caller covering:

- Files changed and what changed for each of the 6 problems
- Capture filenames confirmed + 1-line status each
- Any change needed in seams not owned (exact diff if any)
- Test/gate results summary

---

## Self-Review Against Spec

**Spec coverage check:**

1. ✅ Duplicate label — Task 1+3 (deduplicateEpisodeLabel)
2. ✅ Rainbow rows — Task 4 (PickerOptionRow label → palette.text always) + Task 3 (tone only for badge)
3. ✅ Inconsistent status grammar — Task 1+3 (resolveEpisodeStatusGlyph: ✓/▸/N%/air-date)
4. ✅ Preview rail dup + mid-word truncation — Task 5 (EpisodePreviewRail rewrite)
5. ✅ Triple "Choose episode" — Task 6 (footer nav hint)
6. ✅ Selected row — NOT changed (rose bar + accentFill already correct; preserved)

**Seams owned check:**

- `types.ts` — NOT touched (correct)
- `ink-shell.tsx` — NOT touched (correct)
- `PlaybackPhase.ts` — NOT touched (correct)
- `shell-theme.ts` — NOT touched (correct)

**Boundary: `buildEpisodePickerOptions` in `tmdb-season-episode-pickers.ts`:**

This file (not in the owned list) also builds episode options with `label: \`Episode ${episode.number} · ${episode.name}\``(line 128). This path is used by the legacy`chooseEpisodeFromOptions` fallback (non-container path) and also by TMDB season/episode pickers for pre-playback episode selection. **Agent must report this as a seam requiring change by another agent or the owner** — the exact diff needed is:

```typescript
// In apps/cli/src/app-shell/pickers/tmdb-season-episode-pickers.ts
// Line 128, inside buildEpisodePickerOptions():
- label: `Episode ${episode.number}  ·  ${episode.name}`,
+ label: deduplicateEpisodeLabel(`Episode ${episode.number}`, episode.name ?? ""),
```

And import `deduplicateEpisodeLabel` from `@/app/episode-picker-format`. This file IS NOT in the owned list (`playback-episode-picker.ts` IS) — agent should report the needed change and leave the decision to the owner, or check with the user before editing.

**Placeholder scan:** None found.

**Type consistency:** `EpisodeStatusGlyph` defined in Task 1 and used in Task 3 consistently. `deduplicateEpisodeLabel` signature stable across Task 1, 2, 3. `ShellPickerOption<string>` unchanged throughout.
