# Plan 067: Analytics — link the chart and its table twin by hover

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/docs/components/analytics/` and confirm plan 064 landed (`trend-table.tsx` exists as a client component with chunked reveal).
> Mismatch → re-derive; this plan assumes the post-064 table shape.

Found while sweeping `apps/docs` for interaction gaps.

## Status

- **Priority:** P3
- **Effort:** M
- **Risk:** LOW-MED — shared hover state across two client components; the table's no-JS floor must not regress
- **Depends on:** 064 (TrendTable extracted to a client component with chunked reveal)
- **Category:** UX / docs app
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`TrendTable` is billed in the code as "the chart's accessible twin" — but the
two are only co-located, not connected. Hovering a day on `ChartInstalls`
shows a tooltip; finding that same day in the table is a manual scroll-hunt
through the scroll box. Closing that loop is what makes them one surface: the
chart locates, the table reads.

The interaction design resolves in one direction only, and that is correct:
the chart is not keyboard-navigable (recharts SVG + pointer events), while the
table is the keyboard/screen-reader path. So the sync is **chart → table** —
hover a day on the chart, its row highlights and scrolls into view. The
reverse (table row → chart crosshair) has no clean recharts hook and buys
little; note it as deliberately out.

One subtlety that makes this more than a highlight: under 064's chunked
reveal, an old day may not be *rendered* yet. Hovering it on the chart should
auto-expand chunks until the row exists, then scroll to it — the chart becomes
a range selector for the table.

## Current state (post-064 assumptions)

- `trend-table.tsx` is a `"use client"` component rendering newest-first rows
  in `PAGE_SIZE` chunks with a "Show more" control.
- `chart-installs.tsx` is already a client component; recharts `AreaChart`
  exposes `onMouseMove`/`onMouseLeave` with `activeLabel` (the `t` epoch) —
  `dayFromEpoch` inversion or a `Map<epoch, day>` lookup converts back.
- `TrendSection` (server component) is the common parent.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `bun run --cwd apps/docs test` | all pass |
| Docs build | `bun run --cwd apps/docs build` | exits 0 |
| Full gates | `bun run typecheck --force && bun run test --force` | exit 0 |

## Scope

**In scope:**
- `apps/docs/components/analytics/trend-section.tsx` — a small client wrapper
  (`trend-sync.tsx`) owning `hoveredDay` state, wrapping `ChartInstalls` and
  `TrendTable`
- `chart-installs.tsx` — `onMouseMove`/`onMouseLeave` → day callback
- `trend-table.tsx` — `data-hovered` row styling, scroll-into-view,
  chunk auto-expansion

**Out of scope:**
- Table → chart direction (no clean imperative tooltip API in recharts; the
  table is already the accessible path — it doesn't need the chart to read).
- `ShareOverTime` — same pattern could apply later; keep this to the installs
  chart + its twin first.
- Touch/mouse parity workarounds beyond a sensible default (touch has no
  hover; tapping a chart point can set the day — worth doing if it falls out
  of the same handler).

## Steps

### Step 1: Hovered-day state up the tree

`trend-sync.tsx` (client): `const [hoveredDay, setHoveredDay] = useState<string | null>(null)`.
Passes a setter into `ChartInstalls` (new optional prop `onDayHover`) and the
value into `TrendTable` (`hoveredDay`).

In `ChartInstalls`: `onMouseMove` → `activeLabel` epoch → `day` via the same
`dayToEpoch` inverse the code already has (or a prebuilt `Map`); `onMouseLeave`
→ `null`. Debounce is unnecessary — state is one string.

### Step 2: Row highlight + scroll-into-view

In `TrendTable`: the row whose `point.day === hoveredDay` gets
`data-hovered="true"` (styled via `kunai-chart-row[data-hovered]` — check
`app/styles/charts.css` for an existing hover treatment before inventing one)
and `scrollIntoView({ block: "nearest" })` — the 260px box scrolls internally,
not the page.

### Step 3: Auto-expand to reach hidden days

If `hoveredDay` is beyond the rendered chunk, expand `visibleCount` until the
day is included, then scroll. The "Show more" button remains the same control —
hover just accelerates it. On `mouseleave`, keep the expansion (rows already
revealed stay; collapsing them on leave would shift the layout under the
cursor).

### Step 4: Guard the no-JS floor

`trend-sync.tsx` adds client behavior but must not remove SSR output: the
chart already client-renders; the table's first chunk must still SSR. Assert in
the render test that the SSR HTML still contains the newest chunk.

## Test plan

- New: hovering day D on the chart sets the table's `data-hovered` row to D.
- New: hovering a day past the initial chunk expands and scrolls to it.
- New: `mouseleave` clears the highlight, keeps the expansion.
- Regression: SSR HTML still contains the first chunk (no-JS floor intact);
  `usage-panel.test.tsx`/`trend-table.test.tsx` stay green.

## Done criteria

- [ ] Chart hover highlights + scrolls the matching table row
- [ ] Hidden rows auto-expand to be reached
- [ ] No-JS render unchanged (newest chunk SSR'd)
- [ ] `bun run --cwd apps/docs test` exits 0

## STOP conditions

- 064 has not landed — land it first; this plan assumes chunked client table.
- recharts' `onMouseMove` payload shape changed in this version — re-derive
  the day lookup; do not pin to a field name from memory.

## Maintenance notes

- If `ShareOverTime` later gets the same treatment, hoist `hoveredDay` one
  level higher rather than duplicating the sync wrapper.
