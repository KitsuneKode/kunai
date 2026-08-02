# Calendar Enhancement Implementation Plan (Spec B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the release calendar trustworthy and actionable on the corrected availability spine — correctness pass, "new since last visit" markers, inline actions, and poster-led rows.

**Architecture:** Pure additions to the existing calendar model (`calendar-ui.model.ts`) + render-only changes to `calendar-ui.tsx`, fed a `lastCalendarVisitAt` config value. Actions reuse the **existing browse-shell `onResolve(ShellAction)` path** (play/download/queue/follow already exist) rather than a new router. New-since persistence happens at the calendar **close event** in `browse-shell.tsx`.

**Tech Stack:** Bun, Ink 7 (React 19), `bun run test:file <path>` (single-file) / `bun run test` (full), `captureFrame` harness, `usePosterPreview` (text mini-posters), 4-file config pattern.

**Spec:** `docs/superpowers/specs/2026-06-14-calendar-enhancement-design.md`

**Working dir:** `cd …/apps/cli` for tests/typecheck/lint; `git -C …/kitsunesnipe` for commits. Single-file tests: `bun run test:file <path>`.

**Refinement vs spec:** the spec mentioned `createContainerMediaActionRouter`; in practice the calendar lives in `browse-shell` whose actions already route through `onResolve(ShellAction)` (`download`/`watchlist`/`follow`/queue all exist, `Enter`→`onSubmit` plays). The plan extends that existing path (DRY) instead of injecting a second router.

---

## File Structure

| File                                                                                                                    | Responsibility                                                    | Action        |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------- |
| `apps/cli/src/app-shell/calendar-ui.model.ts`                                                                           | Row state machine (audit), `isReleaseNew`, `isNew` on render rows | Modify        |
| `apps/cli/src/app/calendar-results.ts`                                                                                  | De-dup releases by (titleId, releaseAt)                           | Modify        |
| `apps/cli/src/app-shell/calendar-ui.tsx`                                                                                | New `●` dot + mini-poster cell in `CalendarScheduleRow`           | Modify        |
| `apps/cli/src/app-shell/browse-shell.tsx`                                                                               | Pass `lastVisitAt`; persist on close; `w` follow key + footer     | Modify        |
| `apps/cli/src/services/persistence/ConfigService.ts` / `ConfigStore.ts` / `ConfigServiceImpl.ts` / `config-metadata.ts` | `lastCalendarVisitAt`                                             | Modify        |
| `apps/cli/test/unit/app-shell/calendar-row-state.test.ts`                                                               | State-machine + isReleaseNew tests                                | Create        |
| `apps/cli/test/unit/app-shell/calendar-render-rows.test.ts`                                                             | isNew tagging                                                     | Create        |
| `apps/cli/test/unit/app/calendar-results.test.ts`                                                                       | De-dup test                                                       | Modify        |
| `apps/cli/test/unit/app-shell/calendar-ui.test.tsx`                                                                     | Frame snapshots (dot, poster)                                     | Create/Modify |

---

## Task 1: Correctness — row state machine tests (+ fix)

**Files:**

- Test: `apps/cli/test/unit/app-shell/calendar-row-state.test.ts`
- Modify (only if a test fails): `apps/cli/src/app-shell/calendar-ui.model.ts`

- [ ] **Step 1: Write the tests**

First read `calendarReleaseRowPresentation` and `calendarReleaseRowState` in
`calendar-ui.model.ts` to confirm the exact exported names + the state values
(`countdown` / `resolving` / `missed` / released / airing). Then:

```ts
import { describe, expect, it } from "bun:test";
import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import { calendarReleaseRowPresentation } from "@/app-shell/calendar-ui.model";

const NOW = Date.parse("2026-06-14T12:00:00.000Z");

function option(
  over: Partial<SearchResult["calendar"]> & { releaseAt?: string | null },
): BrowseShellOption<SearchResult> {
  return {
    label: "Show",
    value: {
      id: "t1",
      type: "series",
      name: "Show",
      calendar: {
        source: "anilist",
        titleId: "t1",
        title: "Show",
        contentKind: "series",
        releaseAt: over.releaseAt ?? null,
        releasePrecision: "timestamp",
        releaseStatus: "upcoming",
        providerConfirmed: false,
        display: { time: null, groupLabel: null, episodeCode: "" },
        ...over,
      },
    } as unknown as SearchResult,
  } as BrowseShellOption<SearchResult>;
}

describe("calendarReleaseRowPresentation state", () => {
  it("future release is a countdown", () => {
    const p = calendarReleaseRowPresentation(
      option({ releaseAt: "2026-06-14T14:00:00.000Z" }),
      NOW,
    );
    expect(p.label.toLowerCase()).toContain("in"); // "in 2h"
  });
  it("just-passed release is not a countdown", () => {
    const p = calendarReleaseRowPresentation(
      option({ releaseAt: "2026-06-14T11:59:00.000Z" }),
      NOW,
    );
    expect(p.label.toLowerCase()).not.toContain("in 0");
  });
});
```

Adjust the fixture/assertions to the real shape after reading the model (the exact
`display` sub-shape + presentation return type). The goal is locking the
nowMs-boundary behavior; expand to released/missed/resolving cases mirroring the
real states.

- [ ] **Step 2: Run**

Run: `bun run test:file test/unit/app-shell/calendar-row-state.test.ts`
Expected: PASS if behavior is already correct; if any boundary is wrong, fix the
comparison in `calendarReleaseRowPresentation`/`calendarReleaseRowState` (e.g. use
`>`/`<=` against `nowMs` consistently) and re-run to green.

- [ ] **Step 3: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/calendar-ui.model.ts apps/cli/test/unit/app-shell/calendar-row-state.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "test(calendar): lock row state-machine boundaries on the corrected spine"
```

---

## Task 2: Correctness — de-dup releases by (titleId, releaseAt)

**Files:**

- Modify: `apps/cli/src/app/calendar-results.ts`
- Test: `apps/cli/test/unit/app/calendar-results.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `calendar-results.test.ts` (reuse the file's `withCalendarServices` harness):
a schedule input with two entries for the same `titleId` + identical `releaseAt`,
assert the produced `results` contains one row for that pair.

```ts
it("collapses duplicate releases with the same title and release time", async () => {
  // build sorted schedule with two identical (titleId, releaseAt) items via the
  // same harness used by the other tests in this file, then:
  const { results } = await loadCalendarResults(/* container + items per harness */);
  const ids = results.results.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length); // no duplicate title rows for same slot
});
```

(Model the input on the existing tests in the file; they already construct schedule
items + history matches.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/app/calendar-results.test.ts`
Expected: FAIL — duplicate rows present.

- [ ] **Step 3: Implement**

In `calendar-results.ts`, where the sorted calendar items are mapped to results,
de-dup by a `${titleId}:${releaseAt}` key before building options:

```ts
const seen = new Set<string>();
const deduped = sorted.filter((item) => {
  const key = `${item.titleId}:${item.releaseAt ?? "-"}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

Use `deduped` in place of `sorted` for the results/options mapping (keep the
release-progress write loop on the deduped list too).

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file test/unit/app/calendar-results.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app/calendar-results.ts apps/cli/test/unit/app/calendar-results.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "fix(calendar): de-dup releases by title + release time"
```

---

## Task 3: `isReleaseNew` pure helper

**Files:**

- Modify: `apps/cli/src/app-shell/calendar-ui.model.ts`
- Test: `apps/cli/test/unit/app-shell/calendar-row-state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `calendar-row-state.test.ts`:

```ts
import { isReleaseNew } from "@/app-shell/calendar-ui.model";

describe("isReleaseNew", () => {
  const lastVisit = Date.parse("2026-06-13T00:00:00.000Z");
  const now = Date.parse("2026-06-14T12:00:00.000Z");
  it("is new when released after the last visit and on/before now", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-14T06:00:00.000Z" }), lastVisit, now)).toBe(
      true,
    );
  });
  it("is not new when released before the last visit", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-12T06:00:00.000Z" }), lastVisit, now)).toBe(
      false,
    );
  });
  it("is not new for a future release", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-20T06:00:00.000Z" }), lastVisit, now)).toBe(
      false,
    );
  });
  it("is not new when there is no last visit (0) to avoid flooding first run", () => {
    expect(isReleaseNew(option({ releaseAt: "2026-06-14T06:00:00.000Z" }), 0, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/app-shell/calendar-row-state.test.ts`
Expected: FAIL — `isReleaseNew` not exported.

- [ ] **Step 3: Implement**

In `calendar-ui.model.ts`:

```ts
import type { BrowseShellOption } from "@/app-shell/types";

/**
 * A release is "new since last visit" when it became available strictly after the
 * last time the calendar was opened and on/before now. lastVisitAt === 0 (never
 * visited) returns false so the first calendar open is not flooded with dots.
 */
export function isReleaseNew<T>(
  option: BrowseShellOption<T>,
  lastVisitAt: number,
  nowMs: number = Date.now(),
): boolean {
  if (lastVisitAt <= 0) return false;
  const releaseAt = (option as { value?: { calendar?: { releaseAt?: string | null } } }).value
    ?.calendar?.releaseAt;
  if (!releaseAt) return false;
  const ms = Date.parse(releaseAt);
  if (!Number.isFinite(ms)) return false;
  return ms > lastVisitAt && ms <= nowMs;
}
```

(If `BrowseShellOption` is already imported in the file, reuse it and type the
`option.value.calendar` access against the real `SearchResult` type instead of the
inline cast.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file test/unit/app-shell/calendar-row-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/calendar-ui.model.ts apps/cli/test/unit/app-shell/calendar-row-state.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(calendar): isReleaseNew pure helper"
```

---

## Task 4: `lastCalendarVisitAt` config

**Files:**

- `apps/cli/src/services/persistence/ConfigService.ts` / `ConfigStore.ts` / `ConfigServiceImpl.ts` / `config-metadata.ts`

- [ ] **Step 1: Interface** — in `ConfigService.ts`, after `showWatchTimeStats`:

```ts
/** Epoch ms of the last time the release calendar was opened (for "new since" markers). 0 = never. */
lastCalendarVisitAt: number;
```

- [ ] **Step 2: Default** — in `ConfigStore.ts`, after `showWatchTimeStats: true,`:

```ts
  lastCalendarVisitAt: 0,
```

- [ ] **Step 3: Getter** — in `ConfigServiceImpl.ts`, after the `showWatchTimeStats` getter:

```ts
  get lastCalendarVisitAt(): number {
    return this.config.lastCalendarVisitAt;
  }
```

- [ ] **Step 4: Metadata** — in `config-metadata.ts`, add an entry (this one is not
      user-editable; it is internal state). Mirror an existing non-toggle numeric entry's
      shape; set `editable: false`. Read a neighboring numeric entry first and match its
      exact field set. If every existing entry is user-facing/editable, add it with
      `editable: false` and a `section` of `"playback"` or the closest existing section.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/services/persistence/
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(config): lastCalendarVisitAt for calendar new-since markers"
```

---

## Task 5: Tag render rows with `isNew`

**Files:**

- Modify: `apps/cli/src/app-shell/calendar-ui.model.ts` (`CalendarRenderRow` + `buildCalendarRenderRows`)
- Test: `apps/cli/test/unit/app-shell/calendar-render-rows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { buildCalendarRenderRows } from "@/app-shell/calendar-ui.model";
// build two options via the same fixture style as calendar-row-state.test.ts:
// one released after lastVisit, one before.

describe("buildCalendarRenderRows isNew", () => {
  it("tags rows released since the last visit as new", () => {
    const now = Date.parse("2026-06-14T12:00:00.000Z");
    const lastVisit = Date.parse("2026-06-13T00:00:00.000Z");
    const options = [
      ,
      ,/* fresh: releaseAt 2026-06-14T06:00 */
      /* old:   releaseAt 2026-06-12T06:00 */
    ];
    const rows = buildCalendarRenderRows(options, 0, options.length, now, null, false, lastVisit);
    expect(rows[0]?.isNew).toBe(true);
    expect(rows[1]?.isNew).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/app-shell/calendar-render-rows.test.ts`
Expected: FAIL — `isNew` absent / param not accepted.

- [ ] **Step 3: Implement**

In `calendar-ui.model.ts`, add to `CalendarRenderRow<T>`:

```ts
  readonly isNew: boolean;
  readonly posterUrl?: string;
```

Add a `lastVisitAt = 0` parameter to `buildCalendarRenderRows` (append after
`showForYouHeader`), and in the row push set:

```ts
      isNew: isReleaseNew(option, lastVisitAt, nowMs),
      posterUrl:
        (option as { value?: { calendar?: { posterUrl?: string } } }).value?.calendar?.posterUrl ??
        option.previewImageUrl,
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run test:file test/unit/app-shell/calendar-render-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/calendar-ui.model.ts apps/cli/test/unit/app-shell/calendar-render-rows.test.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(calendar): tag render rows with isNew + posterUrl"
```

---

## Task 6: Render — `●` new dot + mini-poster in the row

**Files:**

- Modify: `apps/cli/src/app-shell/calendar-ui.tsx` (`CalendarScheduleRow`)
- Test: `apps/cli/test/unit/app-shell/calendar-ui.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "bun:test";
import React from "react";
import { CalendarScheduleRow } from "@/app-shell/calendar-ui";
import { captureFrame } from "../../harness/render-capture";

// minimal option via the fixture style; render with isNew + posterUrl props.
describe("CalendarScheduleRow new marker", () => {
  it("shows a ● dot for a new release", () => {
    const frame = captureFrame(
      <CalendarScheduleRow
        option={/* fixture */}
        selected={false}
        rowWidth={80}
        timeLabel="06:00"
        isNew
        posterUrl={undefined}
      />,
      { columns: 100 },
    );
    expect(frame).toContain("●");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:file test/unit/app-shell/calendar-ui.test.tsx`
Expected: FAIL — no `●` (prop not rendered).

- [ ] **Step 3: Implement**

Add `isNew?: boolean` and `posterUrl?: string` to `CalendarScheduleRow`'s props.
Add a `CalendarMini` text mini-poster (reuse the queue pattern) near the top of
`calendar-ui.tsx`:

```tsx
import { usePosterPreview } from "./use-poster-preview";

function CalendarMini({ url, title }: { readonly url?: string; readonly title: string }) {
  const { poster } = usePosterPreview(url, {
    rows: 2,
    cols: 4,
    enabled: Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });
  if (poster.kind !== "none") return <Text>{poster.placeholder}</Text>;
  return <Text color={palette.dim}>{title.slice(0, 2).toUpperCase()}</Text>;
}
```

In the row body, prepend a poster cell + new dot before the `ListRow`:

```tsx
<Box flexDirection="row">
  <Box width={5}>
    <CalendarMini url={posterUrl} title={option.label} />
  </Box>
  <Text color={palette.accent}>{isNew ? "● " : "  "}</Text>
  <Box flexGrow={1}>
    <ListRow
      selected={selected}
      rowWidth={Math.max(16, rowWidth - 7)}
      flexColumnIndex={layout.flexColumnIndex}
      columns={columns}
    />
  </Box>
</Box>
```

(Recompute `layout` with the reduced inner width `rowWidth - 7` so columns still
fit. Keep the day/for-you headers above this row unchanged.)

- [ ] **Step 4: Thread the props at the call site**

In `browse-shell.tsx` where `CalendarScheduleRow` is rendered from
`visibleCalendarRows`, pass `isNew={row.isNew}` and `posterUrl={row.posterUrl}`.

- [ ] **Step 5: Run to verify it passes**

Run: `bun run test:file test/unit/app-shell/calendar-ui.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/calendar-ui.tsx apps/cli/src/app-shell/browse-shell.tsx apps/cli/test/unit/app-shell/calendar-ui.test.tsx
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(calendar): new ● dot + mini-poster per release row"
```

---

## Task 7: Wire lastVisitAt (read + persist on close)

**Files:**

- Modify: `apps/cli/src/app-shell/browse-shell.tsx`

- [ ] **Step 1: Pass lastVisitAt into the render rows**

`browse-shell.tsx` builds `calendarRenderRows` via `buildCalendarRenderRows(...)`.
Pass the config value as the new trailing arg. The shell already has access to
config through props/container; thread `settings?.lastCalendarVisitAt ?? 0` (or the
container config) as `lastVisitAt`. Confirm how config reaches browse-shell (it
receives `settings`/config); use that.

- [ ] **Step 2: Persist on calendar close**

When the calendar view is exited (the `onResolve("search")` / back path while
`isCalendarView`), persist the visit timestamp. Add, in the calendar exit handler:

```ts
if (isCalendarView) {
  void onSaveCalendarVisit?.();
}
```

Add an optional `onSaveCalendarVisit?: () => Promise<void> | void` prop to
browse-shell, wired by the parent (SearchPhase / the calendar route owner) to:

```ts
await container.config.update({ lastCalendarVisitAt: Date.now() });
await container.config.save();
```

Place the call at the event where the calendar surface is left (not a render
effect). If browse-shell already has an `onResolve` for back/search, invoke the save
right before resolving when `isCalendarView`.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/browse-shell.tsx apps/cli/src/app/SearchPhase.ts
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(calendar): persist lastCalendarVisitAt on close, feed new-since markers"
```

---

## Task 8: Actionable rows — `w` follow + footer

**Files:**

- Modify: `apps/cli/src/app-shell/browse-shell.tsx`

- [ ] **Step 1: Confirm existing actions work in calendar view**

`Enter`→`onSubmit` (play), `d`/`Ctrl+D`→`onResolve("download")`, `q`/`Q`→queue
already fire in the results zone and the calendar shares it. Verify they are not
gated by `!isCalendarView` (the download guard checks `searchState === "ready"`;
calendar options are ready). No change if they already work.

- [ ] **Step 2: Add `w` follow/bookmark in the results zone**

Near the `d` download binding, add:

```tsx
// Follow / bookmark the highlighted release (results zone).
if (listFocused && input === "w" && selectedOption && searchState === "ready") {
  onResolve("watchlist");
  return;
}
```

(`watchlist` is an existing `ShellAction`; confirm the parent handles it for the
selected option — it already does for browse results.)

- [ ] **Step 3: Footer hint for calendar**

Where the calendar footer/task label is built (the `isCalendarView` branch), include
the action keys: `⏎ play · w follow · d download · q queue · ←→ day · ⇥ type`.
Find the existing calendar footer string and extend it.

- [ ] **Step 4: Typecheck + app-shell tests**

Run: `bun run typecheck && bun run test:file test/unit/app-shell/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/src/app-shell/browse-shell.tsx
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "feat(calendar): follow (w) action + action key footer"
```

---

## Task 9: Frame snapshots + full gate

**Files:**

- Modify: `apps/cli/test/unit/app-shell/calendar-ui.test.tsx`

- [ ] **Step 1: Add responsive snapshots**

Render a small calendar (2-3 rows, one `isNew`, one with `posterUrl`) at columns 130
and 60; assert it contains the title, the `●` for the new row, and does not throw.

- [ ] **Step 2: Run calendar tests**

Run: `bun run test:file test/unit/app-shell/calendar-ui.test.tsx test/unit/app-shell/calendar-render-rows.test.ts test/unit/app-shell/calendar-row-state.test.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli
bun run typecheck
bun run lint
bun run test
```

Then from repo root:

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
bun run build
```

Expected: typecheck clean, lint clean (watch `no-shadow` on new `row`/`option`
locals), all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe add apps/cli/test/unit/app-shell/calendar-ui.test.tsx
git -C /home/kitsunekode/Projects/hacking/kitsunesnipe commit -m "test(calendar): responsive snapshots for new dot + posters"
```

---

## Self-Review notes (for the executor)

- **One-image budget:** mini-posters use `inkEmbedded` text mode (many coexist). Do
  not add a second Kitty image; the spec's "focused Kitty hero" is optional — only
  add it if the calendar already has a single-image rail slot, otherwise skip (text
  minis are enough for this slice).
- **Config reach:** Task 7 assumes config reaches browse-shell + a save callback
  exists or is added. Verify how `settings`/config is threaded; mirror the existing
  `onSaveSettings` callback pattern for `onSaveCalendarVisit`.
- **Fixtures:** Tasks 1/3/5/6 share a calendar-option fixture — define it once at the
  top of `calendar-row-state.test.ts` and import, or copy minimally per file (the
  `SearchResult.calendar` shape is in `domain/calendar/calendar-item.ts`).
- **Actions are already mostly wired** (Task 8) — the real new work is `w` follow +
  footer; verify play/download/queue rather than re-add them.
- **lastVisitAt=0 guard** keeps the first-ever calendar open from flooding `●` dots.
