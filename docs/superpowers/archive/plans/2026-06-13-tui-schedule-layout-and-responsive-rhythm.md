# TUI Schedule Layout & Responsive Rhythm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the stray "grey bar" rules and stacked/duplicate headers in the schedule/history/library surfaces, and make the schedule's vertical chrome behave gracefully at any terminal width and height.

**Architecture:** The breakage is concentrated in shared shell primitives, not the row layout. `SectionGroup` draws its trailing rule on a _detached_ line; the calendar stacks a redundant week band on top of the day band; and the browse list windows by option count (ignoring the extra lines section headers inject). Fix `SectionGroup` to render an inline single-line rule (with an optional inline tag), demote the week band to that inline tag on the day header, collapse the schedule chrome margins under short terminals, and make the list window line-aware so rows never spill into the footer. Lock it all behind full-frame render-capture snapshots.

**Tech Stack:** TypeScript, React 19, Ink 7.0.6, Bun test runner, the repo's `apps/cli/test/harness/render-capture.ts` (`captureFrame`).

**Out of scope (separate plan):** bookmarks reconciliation, queues, playlist, downloads feature-quality work. A dedicated investigation + plan follows after this lands.

**Verified root causes (evidence from rendered frames):**

1. `primitives/SectionGroup.tsx` builds the rule as `<Box flexGrow={1} borderBottom height={0} marginTop={1} />`. `height={0}` + `marginTop={1}` drops the bottom border onto the line _below_ the label → a detached full-width grey bar, ~3 rows per header. Confirmed fix: `height={1}`, no `marginTop` → rule renders inline on the label's line.
2. `b2876b7d` added a week `SectionGroup` (`This week`) above the existing day `SectionGroup` (`THU 11`). Stacked with `For you · releasing today`, a single group boundary costs ~9 rows of chrome (the empty/striped top region and the "header twice" look).
3. Row column layout is healthy — verified clean alignment + `…` truncation at rowWidth 30/56/90. The original text-overlap (image #2) is already fixed by `b2876b7d`.
4. `getBrowseListMaxVisible` windows by option count; per-row section headers add lines that aren't budgeted, so on shorter terminals the list overflows into the footer.

---

## File Structure

- `apps/cli/src/app-shell/primitives/SectionGroup.tsx` — inline single-line rule; new optional `tag` and `rule` props. (shared by schedule/history/library)
- `apps/cli/src/app-shell/calendar-ui.model.ts` — `CalendarRenderRow` loses `showWeekHeader`/`weekHeaderLabel`, gains `weekTag`; new pure `calendarRowLineCost` + `windowCalendarRowsByLines` helpers.
- `apps/cli/src/app-shell/calendar-ui.tsx` — `CalendarScheduleRow` drops the week `SectionGroup`, passes the week label as the day header's inline `tag`; `CalendarTypeTabs`/`CalendarDayStrip` get a `dense` margin mode.
- `apps/cli/src/app-shell/primitives/ClaudeTabRow.tsx` — `dense` margin mode.
- `apps/cli/src/app-shell/browse-shell.tsx` — pass `weekTag`, pass `dense` (from `viewport.rows`), switch calendar windowing to the line-aware helper.
- Tests:
  - `apps/cli/test/unit/app-shell/section-group.test.tsx` (new) — inline rule + tag snapshots.
  - `apps/cli/test/unit/app-shell/calendar-ui.test.ts` (modify) — `weekTag`, line-cost, line-window.
  - `apps/cli/test/unit/app-shell/schedule-frame.test.tsx` (new) — full-frame snapshots across widths + short height.

---

### Task 1: SectionGroup renders an inline single-line rule (+ optional tag)

**Files:**

- Test: `apps/cli/test/unit/app-shell/section-group.test.tsx` (create)
- Modify: `apps/cli/src/app-shell/primitives/SectionGroup.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/section-group.test.tsx`:

```tsx
import { expect, test } from "bun:test";
import React from "react";
import { Box } from "ink";

import { captureFrame } from "../harness/render-capture";
import { SectionGroup } from "@/app-shell/primitives/SectionGroup";

function frameLines(node: React.ReactElement): string[] {
  return captureFrame(node, { columns: 100 })
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") // strip ANSI/cursor escapes
    .split("\n");
}

test("renders the rule inline on the label's line (no detached bar)", () => {
  const lines = frameLines(
    <Box flexDirection="column" width={40}>
      <SectionGroup label="THU 11" marginTop={0} />
    </Box>,
  );
  const labelLine = lines.find((l) => l.includes("THU 11"));
  expect(labelLine).toBeDefined();
  // The rule must be on the SAME line as the label.
  expect(labelLine).toContain("─");
  // No line may consist solely of the rule (the old detached "grey bar").
  const detached = lines.filter((l) => l.trim().length > 0 && /^─+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("renders an inline tag between the label and the rule", () => {
  const lines = frameLines(
    <Box flexDirection="column" width={48}>
      <SectionGroup label="THU 18" tag="next week" marginTop={0} />
    </Box>,
  );
  const labelLine = lines.find((l) => l.includes("THU 18"));
  expect(labelLine).toBeDefined();
  expect(labelLine).toContain("next week");
  expect(labelLine!.indexOf("THU 18")).toBeLessThan(labelLine!.indexOf("next week"));
  expect(labelLine!.indexOf("next week")).toBeLessThan(labelLine!.indexOf("─"));
});

test("rule=false omits the rule but keeps the label", () => {
  const lines = frameLines(
    <Box flexDirection="column" width={40}>
      <SectionGroup label="LIBRARY" rule={false} marginTop={0} />
    </Box>,
  );
  const labelLine = lines.find((l) => l.includes("LIBRARY"));
  expect(labelLine).toBeDefined();
  expect(labelLine).not.toContain("─");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun run test test/unit/app-shell/section-group.test.tsx`
Expected: FAIL — the "no detached bar" assertion fails (current rule is on its own line); `tag`/`rule` props don't exist yet.

- [ ] **Step 3: Implement the inline rule + tag + rule toggle**

Replace the body of `apps/cli/src/app-shell/primitives/SectionGroup.tsx`:

```tsx
import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

/** Uppercase section label with an inline trailing rule (Sakura systems shelf bands).
 *  The rule sits on the SAME line as the label; an optional `tag` shows quiet
 *  secondary context (e.g. a week marker) between the label and the rule. */
export const SectionGroup = React.memo(function SectionGroup({
  label,
  tag,
  marginTop = 1,
  rule = true,
}: {
  readonly label: string;
  readonly tag?: string;
  readonly marginTop?: number;
  /** When false, render only the label (+ tag) with no trailing rule. */
  readonly rule?: boolean;
}) {
  return (
    <Box
      marginTop={marginTop}
      marginBottom={0}
      flexDirection="row"
      gap={1}
      width="100%"
      overflow="hidden"
    >
      <Text color={palette.muted}>{label.toUpperCase()}</Text>
      {tag ? (
        <Text color={palette.dim} dimColor>
          {tag}
        </Text>
      ) : null}
      {rule ? (
        <Box
          flexGrow={1}
          borderStyle="single"
          borderBottom
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          borderColor={palette.lineSoft}
          height={1}
        />
      ) : null}
    </Box>
  );
});
```

(The only behavioural change vs. the current file is `height={1}` replacing `height={0} marginTop={1}` on the rule box, plus the new `tag`/`rule` props and `overflow="hidden"`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun run test test/unit/app-shell/section-group.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/primitives/SectionGroup.tsx apps/cli/test/unit/app-shell/section-group.test.tsx
git commit -m "fix(cli): render SectionGroup rule inline with optional tag"
```

---

### Task 2: Demote the schedule week band to an inline day-header tag

**Files:**

- Modify: `apps/cli/src/app-shell/calendar-ui.model.ts:40-54` (type) and `:435-492` (`buildCalendarRenderRows`)
- Test: `apps/cli/test/unit/app-shell/calendar-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/cli/test/unit/app-shell/calendar-ui.test.ts` (uses the existing `dayStripOption` helper in that file):

```ts
test("emits a weekTag (not a separate week header) when the week changes", () => {
  const nowMs = Date.parse("2026-06-11T00:00:00");
  const options = [
    dayStripOption({ label: "A", previewGroup: "2026-06-11", previewDayKey: "2026-06-11" }),
    dayStripOption({ label: "B", previewGroup: "2026-06-18", previewDayKey: "2026-06-18" }),
  ];
  const rows = buildCalendarRenderRows(options, 0, options.length, nowMs, null, false);

  // Week field is now a tag string on the day-header row, not a separate band.
  expect(rows[0]).not.toHaveProperty("showWeekHeader");
  expect(rows[0]!.showDayHeader).toBe(true);
  // Second row crosses into a new week → carries a non-null weekTag alongside its day header.
  expect(rows[1]!.showDayHeader).toBe(true);
  expect(rows[1]!.weekTag).toBe("next week");
  // First row's week tag may be present ("this week") or null; it must never duplicate the day band.
  expect(typeof rows[0]!.weekTag === "string" || rows[0]!.weekTag === null).toBe(true);
});
```

Also delete/replace any existing assertions in this file that reference `showWeekHeader` or `weekHeaderLabel` (search the file for `weekHeader`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun run test test/unit/app-shell/calendar-ui.test.ts`
Expected: FAIL — `weekTag` does not exist; `showWeekHeader` still present.

- [ ] **Step 3: Update the render-row type**

In `apps/cli/src/app-shell/calendar-ui.model.ts`, change the `CalendarRenderRow` type (currently lines ~40-54): remove `showWeekHeader` and `weekHeaderLabel`, add `weekTag`:

```ts
export type CalendarRenderRow<T> = {
  readonly option: BrowseShellOption<T>;
  readonly optionIndex: number;
  readonly timeLabel: string;
  readonly episodeCode: string;
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly statusDim: boolean;
  readonly statusGlyph: string;
  /** Quiet week marker shown inline on the day header when the week changes. */
  readonly weekTag: string | null;
  readonly showDayHeader: boolean;
  readonly dayHeaderLabel: string | null;
  readonly showForYouHeaderOnce: boolean;
};
```

- [ ] **Step 4: Update `buildCalendarRenderRows`**

In the same file, inside `buildCalendarRenderRows` (~lines 435-492), replace the week-header computation and the pushed object. Change the `showWeekHeader` block to compute a `weekTag`:

```ts
const weekHeaderLabel =
  selectedDayKey === null && dayHeaderLabel
    ? calendarWeekHeaderLabel(calendarWeekKeyFromIsoDay(dayHeaderLabel), nowMs)
    : null;
const weekChanged = weekHeaderLabel !== null && weekHeaderLabel !== lastWeekHeader;
if (weekChanged) lastWeekHeader = weekHeaderLabel;
const showDayHeader = dayHeaderLabel !== null && dayHeaderLabel !== lastDayHeader;
if (showDayHeader) lastDayHeader = dayHeaderLabel;
// The week marker rides the day header (no separate band). Lowercased so it
// reads as a quiet tag ("next week"), not a second heading.
const weekTag = showDayHeader && weekChanged ? weekHeaderLabel!.toLowerCase() : null;
```

Then update the `rows.push({ ... })` to drop `showWeekHeader`/`weekHeaderLabel` and add `weekTag`:

```ts
rows.push({
  option,
  optionIndex: index,
  timeLabel,
  episodeCode,
  statusLabel: presentation.label,
  statusColor: presentation.color,
  statusDim: presentation.dim,
  statusGlyph: presentation.glyph.trim(),
  weekTag,
  showDayHeader,
  dayHeaderLabel: showDayHeader ? dayHeaderLabel : null,
  showForYouHeaderOnce,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/cli && bun run test test/unit/app-shell/calendar-ui.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/calendar-ui.model.ts apps/cli/test/unit/app-shell/calendar-ui.test.ts
git commit -m "feat(cli): carry schedule week marker as an inline day-header tag"
```

---

### Task 3: Wire CalendarScheduleRow to the inline week tag (drop the week band)

**Files:**

- Modify: `apps/cli/src/app-shell/calendar-ui.tsx:114-202` (`CalendarScheduleRow`)
- Modify: `apps/cli/src/app-shell/browse-shell.tsx:1225-1242` (CalendarScheduleRow invocation)

> No new unit test here — Task 5's full-frame snapshot is the regression guard; this step is wiring that must keep the suite green.

- [ ] **Step 1: Update `CalendarScheduleRow` props + render**

In `apps/cli/src/app-shell/calendar-ui.tsx`, in the `CalendarScheduleRow` prop list, remove `showWeekHeader` and `weekHeaderLabel` and add `weekTag`:

```tsx
  showForYouHeader,
  showForYouHeaderOnce,
  weekTag,
}: {
  option: BrowseShellOption<T>;
  selected: boolean;
  rowWidth: number;
  showDayHeader?: boolean;
  dayHeaderLabel?: string | null;
  timeLabel: string;
  episodeCode?: string;
  statusLabel?: string;
  statusColor?: string;
  statusDim?: boolean;
  statusGlyph?: string;
  showForYouHeader?: boolean;
  showForYouHeaderOnce?: boolean;
  weekTag?: string | null;
  showTimeHeader?: boolean;
  showTbdHeader?: boolean;
  showSectionHeader?: string | null;
  nowMs?: number;
}) {
```

Then replace the header block in the returned JSX (remove the week `SectionGroup`, add the tag to the day header):

```tsx
return (
  <Box flexDirection="column" width={rowWidth} marginBottom={0}>
    {showForYouHeader && showForYouHeaderOnce ? (
      <SectionGroup label="For you · releasing today" marginTop={1} />
    ) : null}
    {showDayHeader && dayHeaderLabel ? (
      <SectionGroup label={dayHeaderLabel} tag={weekTag ?? undefined} marginTop={1} />
    ) : null}
    <ListRow
      selected={selected}
      rowWidth={rowWidth}
      flexColumnIndex={layout.flexColumnIndex}
      columns={columns}
    />
  </Box>
);
```

- [ ] **Step 2: Update the invocation in `browse-shell.tsx`**

In `apps/cli/src/app-shell/browse-shell.tsx` (the `.map((row) => (<CalendarScheduleRow ... />))` around lines 1225-1242), remove the `showWeekHeader`/`weekHeaderLabel` props and add `weekTag`:

```tsx
<CalendarScheduleRow
  key={`${row.option.label}-${row.optionIndex}-${row.timeLabel}`}
  option={row.option}
  selected={row.optionIndex === boundedSelectedIndex}
  rowWidth={rowWidth}
  timeLabel={row.timeLabel}
  episodeCode={row.episodeCode}
  statusLabel={row.statusLabel}
  statusColor={row.statusColor}
  statusDim={row.statusDim}
  statusGlyph={row.statusGlyph}
  showDayHeader={row.showDayHeader}
  dayHeaderLabel={row.dayHeaderLabel}
  weekTag={row.weekTag}
  showForYouHeader={calendarDayFilter === null}
  showForYouHeaderOnce={row.showForYouHeaderOnce}
/>
```

- [ ] **Step 3: Verify typecheck + full suite**

Run: `cd apps/cli && bun run typecheck && bun run test`
Expected: typecheck clean; suite PASS (no references to removed props remain).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/app-shell/calendar-ui.tsx apps/cli/src/app-shell/browse-shell.tsx
git commit -m "refactor(cli): drop stacked week band, show week as day-header tag"
```

---

### Task 4: Line-aware calendar windowing (rows never spill into the footer)

**Files:**

- Modify: `apps/cli/src/app-shell/calendar-ui.model.ts` (add two pure helpers near `buildCalendarRenderRows`)
- Test: `apps/cli/test/unit/app-shell/calendar-ui.test.ts`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx` (calendar render path)

- [ ] **Step 1: Write the failing test**

Add to `apps/cli/test/unit/app-shell/calendar-ui.test.ts`:

```ts
import { calendarRowLineCost, windowCalendarRowsByLines } from "@/app-shell/calendar-ui.model";

test("calendarRowLineCost counts headers as extra lines", () => {
  const base = {
    option: dayStripOption({ label: "X" }),
    optionIndex: 0,
    timeLabel: "6 PM",
    episodeCode: "E1",
    statusLabel: "resolving",
    statusColor: "#fff",
    statusDim: true,
    statusGlyph: "·",
    weekTag: null as string | null,
    showDayHeader: false,
    dayHeaderLabel: null as string | null,
    showForYouHeaderOnce: false,
  };
  expect(calendarRowLineCost(base)).toBe(1);
  expect(calendarRowLineCost({ ...base, showDayHeader: true, dayHeaderLabel: "THU 11" })).toBe(3);
  expect(calendarRowLineCost({ ...base, showForYouHeaderOnce: true })).toBe(3);
});

test("windowCalendarRowsByLines keeps the selected row inside the line budget", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    option: dayStripOption({ label: `row-${i}` }),
    optionIndex: i,
    timeLabel: "6 PM",
    episodeCode: "E1",
    statusLabel: "resolving",
    statusColor: "#fff",
    statusDim: true,
    statusGlyph: "·",
    weekTag: null as string | null,
    showDayHeader: i % 5 === 0,
    dayHeaderLabel: i % 5 === 0 ? "DAY" : null,
    showForYouHeaderOnce: false,
  }));
  const { start, end } = windowCalendarRowsByLines(rows, 22, 10);
  expect(start).toBeLessThanOrEqual(22);
  expect(end).toBeGreaterThan(22);
  const lines = rows.slice(start, end).reduce((sum, r) => sum + calendarRowLineCost(r), 0);
  expect(lines).toBeLessThanOrEqual(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun run test test/unit/app-shell/calendar-ui.test.ts`
Expected: FAIL — `calendarRowLineCost`/`windowCalendarRowsByLines` not exported.

- [ ] **Step 3: Implement the two pure helpers**

In `apps/cli/src/app-shell/calendar-ui.model.ts`, after `buildCalendarRenderRows`, add:

```ts
/** Rendered line cost of a calendar row: the row itself + any headers it carries.
 *  A header is a SectionGroup = 1 margin line + 1 label line = 2 extra lines. */
export function calendarRowLineCost<T>(row: CalendarRenderRow<T>): number {
  let lines = 1;
  if (row.showForYouHeaderOnce) lines += 2;
  if (row.showDayHeader) lines += 2;
  return lines;
}

/** Pick a contiguous slice of pre-built render rows that fits `maxLines` of
 *  rendered height while keeping `selectedIndex` visible. Grows downward first
 *  (natural reading order), then upward to use any remaining budget. */
export function windowCalendarRowsByLines<T>(
  rows: readonly CalendarRenderRow<T>[],
  selectedIndex: number,
  maxLines: number,
): { readonly start: number; readonly end: number } {
  if (rows.length === 0) return { start: 0, end: 0 };
  const budget = Math.max(1, maxLines);
  const anchor = Math.min(Math.max(0, selectedIndex), rows.length - 1);

  let used = calendarRowLineCost(rows[anchor]!);
  let start = anchor;
  let end = anchor + 1; // exclusive

  // Grow downward.
  while (end < rows.length) {
    const next = used + calendarRowLineCost(rows[end]!);
    if (next > budget) break;
    used = next;
    end += 1;
  }
  // Grow upward with whatever budget remains.
  while (start > 0) {
    const next = used + calendarRowLineCost(rows[start - 1]!);
    if (next > budget) break;
    used = next;
    start -= 1;
  }
  return { start, end };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun run test test/unit/app-shell/calendar-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the line-aware window in the calendar render path**

In `apps/cli/src/app-shell/browse-shell.tsx`, the calendar branch currently calls `buildCalendarRenderRows(displayOptions, windowStart, windowEnd, ...)`. Replace it so the full render rows are built once (stable day-header flags), then sliced by line budget. Add this import to the existing `calendar-ui.model` import block:

```ts
  buildCalendarRenderRows,
  calendarRowLineCost,
  windowCalendarRowsByLines,
```

Replace the calendar `.map(...)` source (around lines 1214-1243). Build the rows above the JSX (near where `visibleOptions` is computed, inside the component body), guarded to the calendar view:

```tsx
const calendarRenderRows = isCalendarView
  ? buildCalendarRenderRows(
      displayOptions as readonly BrowseShellOption<import("@/domain/types").SearchResult>[],
      0,
      displayOptions.length,
      calendarNow,
      calendarDayFilter,
      calendarDayFilter === null,
    )
  : [];
const calendarWindow = windowCalendarRowsByLines(
  calendarRenderRows,
  boundedSelectedIndex,
  maxVisible,
);
const visibleCalendarRows = calendarRenderRows.slice(calendarWindow.start, calendarWindow.end);
```

Then in the JSX, replace the scroll affordances + map. The "more above/below" markers now key off `calendarWindow`:

```tsx
              {(isCalendarView ? calendarWindow.start : windowStart) > 0 ? (
                <Text color={palette.dim}> ▲ ...</Text>
              ) : null}
              {isCalendarView
                ? visibleCalendarRows.map((row) => (
                    <CalendarScheduleRow
                      key={`${row.option.label}-${row.optionIndex}-${row.timeLabel}`}
                      option={row.option}
                      selected={row.optionIndex === boundedSelectedIndex}
                      rowWidth={rowWidth}
                      timeLabel={row.timeLabel}
                      episodeCode={row.episodeCode}
                      statusLabel={row.statusLabel}
                      statusColor={row.statusColor}
                      statusDim={row.statusDim}
                      statusGlyph={row.statusGlyph}
                      showDayHeader={row.showDayHeader}
                      dayHeaderLabel={row.dayHeaderLabel}
                      weekTag={row.weekTag}
                      showForYouHeader={calendarDayFilter === null}
                      showForYouHeaderOnce={row.showForYouHeaderOnce}
                    />
                  ))
                : visibleOptions.map((option, index) => {
```

And update the trailing "more below" marker at the end of the list column:

```tsx
{
  (
    isCalendarView
      ? calendarWindow.end < calendarRenderRows.length
      : windowEnd < displayOptions.length
  ) ? (
    <Text color={palette.dim}> ▼ ...</Text>
  ) : null;
}
```

> Note: the non-calendar branch keeps using `windowStart`/`windowEnd`/`visibleOptions` unchanged. Only the calendar branch switches to the line-aware window.

- [ ] **Step 6: Verify typecheck + full suite**

Run: `cd apps/cli && bun run typecheck && bun run test`
Expected: typecheck clean; suite PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/app-shell/calendar-ui.model.ts apps/cli/src/app-shell/browse-shell.tsx apps/cli/test/unit/app-shell/calendar-ui.test.ts
git commit -m "fix(cli): window the schedule list by rendered lines, not option count"
```

---

### Task 5: Collapse schedule chrome margins under short terminals (dense mode)

**Files:**

- Modify: `apps/cli/src/app-shell/primitives/ClaudeTabRow.tsx`
- Modify: `apps/cli/src/app-shell/calendar-ui.tsx` (`CalendarTypeTabs`, `CalendarDayStrip`)
- Modify: `apps/cli/src/app-shell/browse-shell.tsx` (pass `dense`)

> Regression guard is Task 6's short-height snapshot. This task adds the `dense` plumbing.

- [ ] **Step 1: Add `dense` to `ClaudeTabRow`**

In `apps/cli/src/app-shell/primitives/ClaudeTabRow.tsx`, add a `dense` prop that zeroes the vertical margins:

```tsx
export const ClaudeTabRow = React.memo(function ClaudeTabRow({
  labels,
  activeIndex,
  hint,
  maxWidth,
  dense = false,
}: {
  readonly labels: readonly string[];
  readonly activeIndex: number;
  readonly hint?: string;
  readonly maxWidth?: number;
  readonly dense?: boolean;
}) {
  const segments = segmentGeometry(labels, activeIndex);
  return (
    <Box
      flexDirection="row"
      marginTop={dense ? 0 : 1}
      marginBottom={dense ? 0 : 1}
      alignItems="center"
      width={maxWidth}
      overflow="hidden"
    >
```

(rest of the component unchanged.)

- [ ] **Step 2: Add `dense` to `CalendarTypeTabs` and `CalendarDayStrip`**

In `apps/cli/src/app-shell/calendar-ui.tsx`:

`CalendarTypeTabs` — accept `dense` and forward it:

```tsx
export function CalendarTypeTabs({
  activeTab,
  compact,
  maxWidth,
  dense = false,
}: {
  activeTab: CalendarTypeTab;
  compact: boolean;
  maxWidth?: number;
  dense?: boolean;
}) {
  if (compact) return null;
  const labels = CALENDAR_TYPE_TABS.map((tab) => (tab === "TV" ? "Series" : tab));
  const activeIndex = CALENDAR_TYPE_TABS.indexOf(activeTab);
  return (
    <ClaudeTabRow
      labels={labels}
      activeIndex={activeIndex}
      hint={maxWidth === undefined || maxWidth >= 100 ? "⇥ Tab cycles type" : undefined}
      maxWidth={maxWidth}
      dense={dense}
    />
  );
}
```

`CalendarDayStrip` — accept `dense` and apply to the outer `Box` margins:

```tsx
export function CalendarDayStrip({
  days,
  selectedDayKey,
  narrow = false,
  maxWidth,
  dense = false,
}: {
  days: readonly CalendarDay[];
  selectedDayKey: string | null;
  narrow?: boolean;
  maxWidth?: number;
  dense?: boolean;
}) {
  const { windowDays, hasPrev, hasNext } = windowCalendarDayStrip(days, selectedDayKey, narrow);
  const showHint = maxWidth === undefined || maxWidth >= 92;

  return (
    <Box
      flexDirection="row"
      marginTop={dense ? 0 : 1}
      marginBottom={dense ? 0 : 1}
      alignItems="center"
      width={maxWidth}
      overflow="hidden"
    >
```

(rest of both components unchanged.)

- [ ] **Step 3: Derive and pass `dense` in `browse-shell.tsx`**

In `apps/cli/src/app-shell/browse-shell.tsx`, where `const { compact, ultraCompact, minColumns, minRows } = viewport;` is destructured (~line 648), add a `dense` derivation just below it:

```tsx
// Short terminals: collapse schedule chrome margins so the list keeps its rows.
const denseChrome = viewport.rows < 28;
```

Then update the calendar chrome block (~lines 1182-1192) to pass `dense`:

```tsx
{
  isCalendarView && calendarDays.length > 0 && !ultraCompact ? (
    <Box flexDirection="column">
      <CalendarTypeTabs
        activeTab={calendarTypeTab}
        compact={compact}
        maxWidth={listWidth}
        dense={denseChrome}
      />
      <CalendarDayStrip
        days={calendarDays}
        selectedDayKey={calendarDayFilter}
        narrow={viewport.breakpoint === "narrow"}
        maxWidth={listWidth}
        dense={denseChrome}
      />
    </Box>
  ) : null;
}
```

- [ ] **Step 4: Verify typecheck + full suite**

Run: `cd apps/cli && bun run typecheck && bun run test`
Expected: typecheck clean; suite PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/primitives/ClaudeTabRow.tsx apps/cli/src/app-shell/calendar-ui.tsx apps/cli/src/app-shell/browse-shell.tsx
git commit -m "feat(cli): collapse schedule chrome margins on short terminals"
```

---

### Task 6: Full-frame snapshot regression for schedule/history/library

**Files:**

- Test: `apps/cli/test/unit/app-shell/schedule-frame.test.tsx` (create)

- [ ] **Step 1: Write the snapshot/assertion test**

Create `apps/cli/test/unit/app-shell/schedule-frame.test.tsx`. This renders the real `CalendarScheduleRow`s through a window and asserts the invariants that broke (no detached rule lines, headers single-line, body fits the line budget). Use complete fake options so `calendarReleaseRowPresentation` does not throw (it reads `calendar.display.statusLabel`).

```tsx
import { expect, test } from "bun:test";
import React from "react";
import { Box } from "ink";

import { captureFrame } from "../harness/render-capture";
import { CalendarScheduleRow } from "@/app-shell/calendar-ui";
import {
  buildCalendarRenderRows,
  calendarRowLineCost,
  windowCalendarRowsByLines,
} from "@/app-shell/calendar-ui.model";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

function scheduleOption(label: string, dayKey: string): BrowseShellOption<SearchResult> {
  return {
    label,
    value: { id: label, type: "series", title: label } as SearchResult,
    calendar: {
      contentKind: "anime",
      providerConfirmed: false,
      releaseStatus: "known",
      dayKey,
      display: {
        statusLabel: "aired · resolving",
        time: "6:00 PM",
        groupLabel: dayKey,
        episodeCode: "E10",
      },
    },
  } as unknown as BrowseShellOption<SearchResult>;
}

const DAYS = ["2026-06-11", "2026-06-18", "2026-06-22"];
const OPTIONS = DAYS.flatMap((day, d) =>
  Array.from({ length: 6 }, (_, i) => scheduleOption(`Title ${d}-${i} A Fairly Long Name`, day)),
);

function renderSchedule(rowWidth: number, maxLines: number): string {
  const rows = buildCalendarRenderRows(
    OPTIONS,
    0,
    OPTIONS.length,
    Date.parse("2026-06-11T00:00:00"),
    null,
    true,
  );
  const win = windowCalendarRowsByLines(rows, 0, maxLines);
  const node = (
    <Box flexDirection="column" width={rowWidth + 4}>
      {rows.slice(win.start, win.end).map((row) => (
        <CalendarScheduleRow
          key={`${row.option.label}-${row.optionIndex}`}
          option={row.option}
          selected={row.optionIndex === 0}
          rowWidth={rowWidth}
          timeLabel={row.timeLabel}
          episodeCode={row.episodeCode}
          statusLabel={row.statusLabel}
          statusColor="#cccccc"
          statusDim={row.statusDim}
          statusGlyph={row.statusGlyph}
          showDayHeader={row.showDayHeader}
          dayHeaderLabel={row.dayHeaderLabel}
          weekTag={row.weekTag}
          showForYouHeader
          showForYouHeaderOnce={row.showForYouHeaderOnce}
        />
      ))}
    </Box>
  );
  return captureFrame(node, { columns: Math.max(120, rowWidth + 20) }).replace(
    /\x1b\[[0-9;?]*[A-Za-z]/g,
    "",
  );
}

test.each([56, 90, 116])("schedule has no detached rule lines at rowWidth=%i", (rowWidth) => {
  const frame = renderSchedule(rowWidth, 30);
  const detached = frame.split("\n").filter((l) => l.trim().length > 0 && /^─+$/.test(l.trim()));
  expect(detached).toHaveLength(0);
});

test("schedule window respects a short line budget", () => {
  const rows = buildCalendarRenderRows(
    OPTIONS,
    0,
    OPTIONS.length,
    Date.parse("2026-06-11T00:00:00"),
    null,
    true,
  );
  const win = windowCalendarRowsByLines(rows, 0, 8);
  const used = rows.slice(win.start, win.end).reduce((sum, r) => sum + calendarRowLineCost(r), 0);
  expect(used).toBeLessThanOrEqual(8);
  expect(win.end).toBeGreaterThan(win.start);
});

test("day header carries the week tag inline (no standalone week band)", () => {
  const frame = renderSchedule(90, 30);
  // A line that is only an uppercased week label would be the old standalone band.
  const standaloneWeek = frame
    .split("\n")
    .some((l) => /^\s*(THIS WEEK|NEXT WEEK|WEEK OF)\b/.test(l));
  expect(standaloneWeek).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd apps/cli && bun run test test/unit/app-shell/schedule-frame.test.tsx`
Expected: PASS (all cases). If `calendar-item` requires extra fields, widen the `scheduleOption` cast — the existing `calendar-ui.test.ts` `dayStripOption`/`buildCalendarItem` helpers are the reference for required shape.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/test/unit/app-shell/schedule-frame.test.tsx
git commit -m "test(cli): full-frame schedule snapshots guard header/window regressions"
```

---

### Task 7: Final verification gate

- [ ] **Step 1: Run the full quality gate**

Run from repo root:

```bash
cd apps/cli && bun run typecheck && bun run lint && bun run test
```

Expected: all clean / green.

- [ ] **Step 2: Build**

Run: `cd apps/cli && bun run build`
Expected: build succeeds (catches build-only errors).

- [ ] **Step 3: Manual smoke (real terminal)**

Run: `bun run dev -- -a` then open the schedule/calendar surface. Confirm visually:

- No stray grey bars; each day header is one line ending in a rule.
- Week context appears as a quiet `next week`-style tag on the first day header of a new week, not a second band.
- Resize the terminal narrow→wide and short→tall: rows truncate with `…`, the list never overlaps the footer, and chrome margins collapse when the window is short.
- Repeat the eyeball check on history and library surfaces (they share `SectionGroup`).

- [ ] **Step 4: Format + final commit (if formatter changed anything)**

```bash
cd apps/cli && bun run fmt
git add -A && git commit -m "style(cli): fmt schedule layout changes" || echo "nothing to format"
```

---

## Self-Review

**Spec coverage:**

- Grey bars / detached rule → Task 1 (root fix in shared `SectionGroup`).
- Stacked/duplicate headers → Tasks 2-3 (week band demoted to inline tag).
- Original text overlap (image #2) → already fixed by `b2876b7d`; Task 6 snapshots lock it in.
- Works at any width → Tasks 1/6 (rowWidth 56/90/116 snapshots; column math already breakpoint-driven).
- Works at any height → Tasks 4 (line-aware window) + 5 (dense chrome) + 6 (short-budget test).
- Feature-quality (bookmarks/queues/playlist/downloads) → explicitly deferred to a follow-up plan.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output.

**Type consistency:** `weekTag: string | null` is introduced in Task 2 (type + builder), consumed in Task 3 (`CalendarScheduleRow` prop + `browse-shell` invocation) and Task 6 (test). `calendarRowLineCost` / `windowCalendarRowsByLines` are defined in Task 4 and reused in Tasks 4/6. `dense` prop added in Task 5 across `ClaudeTabRow`/`CalendarTypeTabs`/`CalendarDayStrip` with consistent default `false`. `SectionGroup` `tag`/`rule` props (Task 1) are consumed in Task 3.
