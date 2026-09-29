# Plan 064: Day-by-day table — newest first, progressively disclosed

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/docs/components/analytics/ apps/docs/lib/analytics-series.ts apps/analytics-ingest/src/public-series.ts`
> Mismatch → re-read `TrendTable` and the series contract before proceeding.

User-requested UX change on `apps/docs/app/analytics`; surfaced during the
audit-2 S6 review pass.

## Status

- **Priority:** P3
- **Effort:** S
- **Risk:** LOW — presentational; no data contract changes
- **Depends on:** none
- **Category:** UX / docs app
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

The "Day by day" card (`trend-section.tsx:57-91`) renders `series.points`
straight through — and `points` is *ascending*, guaranteed by the parser
(`analytics-series.ts:130` rejects any day that does not strictly increase).
So the table opens on the oldest day in the window, and yesterday — the row a
reader actually wants — sits at the bottom of a 260px scroll box behind ~90
other rows.

The growth concern is real but bounded and worth stating honestly:
`daily_rollup` is never pruned, but `series.json` already caps the window at
`MAX_SERIES_DAYS = 180` (`public-series.ts:22`). The DOM can never exceed 180
rows today — so paging is about initial paint weight and forward-compat if the
cap is ever raised, not a correctness bug. If a "full history" view is ever
wanted, that is an endpoint change (a `before=<day>` cursor on `series.json`),
not a bigger table, and it is out of scope here.

The design constraint that decides the mechanism: **this table is the chart's
accessible twin** (the file's own comment — it exists so every plotted value is
reachable without tooltips). Sentinel-based infinite scroll loads rows on
scroll events, which hands assistive tech a permanently partial table and
makes arbitrary old days awkward to reach. A chunked "Show more" keeps the
twin honest — and because the order is now newest-first, the SSR'd first chunk
is the most valuable chunk, so the no-JS rendering still shows exactly the
days a reader came for.

## Current state

- `TrendTable` is server-rendered inside `trend-section.tsx` (no `"use client"`,
  all rows in the initial HTML, `max-h-[260px] overflow-y-auto` scroll box,
  `sticky thead`).
- Ascending order is a *parse-time contract*, not just a convention — do not
  touch it. The charts (`ChartInstalls`, `ShareSection`) consume the same
  `points` array on the same render.
- No test covers the table (`apps/docs/test/` has series/fetch/derive/panel
  tests; nothing asserts row order or count).

**Trap to name:** `Array.prototype.reverse()` mutates in place. The table
shares `series.points` with both charts — an in-place reverse silently flips
every x-axis on the page. Copy first: `[...points].reverse()` (or
`points.toReversed()` — `[...]` spread is the safer pick given the browser
matrix).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `bun run --cwd apps/docs test` | all pass |
| Docs build | `bun run --cwd apps/docs build` | exits 0 |
| Full gates | `bun run typecheck --force && bun run test --force` | exit 0 |

## Scope

**In scope:**
- `apps/docs/components/analytics/trend-section.tsx` — move `TrendTable` into a
  new `components/analytics/trend-table.tsx`
- `apps/docs/test/trend-table.test.tsx` — new coverage

**Out of scope:**
- `series.json` endpoint changes (cursor pagination, raising
  `MAX_SERIES_DAYS`) — a full-history view is a separate decision.
- The charts — they keep ascending order; only the table flips.
- `apps/analytics-ingest` — no serving change needed.

## Steps

### Step 1: Extract `TrendTable` into a client component

New file `components/analytics/trend-table.tsx`, `"use client"`, same props.
Client components still SSR their first render, so the initial chunk ships in
the HTML — the no-JS reader gets the newest days, which is now the top of the
list.

### Step 2: Newest-first

```ts
const rows = [...points].reverse();
```

Newest day first, under the sticky header. Keep `sticky thead`, `tabular-nums`,
`kunai-chart-row` styling untouched.

### Step 3: Progressive disclosure

Render the first `PAGE_SIZE = 30` rows (one month per click, ≤6 clicks to the
180-day floor), then a "Show 30 more days" button inside the scroll container
appending the next chunk. On exhaustion, the button disappears (or becomes
"All N days shown" text). Keep it a real `<button>` — focusable, announces
itself — and let the row region be reachable without scripting the reveal.
Do **not** use IntersectionObserver sentinel loading: it is the same data
already in memory, it defeats the accessible-twin purpose, and it adds a
scroll listener for zero gain at ≤180 rows.

### Step 4: Keep the fallback honest

With JS off, the first 30 rows are in the HTML and the button is inert — the
newest month is visible, which is the correct degraded read. That is worth a
comment in the file: the SSR'd chunk is not a loading skeleton, it is the
no-JS rendering.

## Test plan

- New (`trend-table.test.tsx`): first `<tbody>` row is `series.to` (newest);
  initial render contains exactly `PAGE_SIZE` rows; clicking through reveals
  all `points.length` rows; button state at exhaustion.
- New: an SSR assertion — `renderToString`-level check that the newest chunk
  is present in initial HTML (mirrors `usage-panel.test.tsx` conventions).
- Regression: `series.points` is unchanged after render (assert the array
  identity/order survives — guards the in-place-reverse trap).

## Done criteria

- [ ] Day-by-day table renders newest-first under the sticky header
- [ ] Initial render is capped at `PAGE_SIZE`; the button reveals the rest
- [ ] Charts are byte-identical in behavior (points array never mutated)
- [ ] No-JS rendering shows the newest month without interaction
- [ ] New tests cover order, chunking, exhaustion, and non-mutation
- [ ] `bun run --cwd apps/docs test` and full gates exit 0

## STOP conditions

- `TrendTable` was already refactored or the card layout changed — re-derive
  from `trend-section.tsx` rather than matching these notes.
- The series endpoint contract changed (e.g. a cursor param or larger cap) —
  the bound argument above needs re-checking before sizing `PAGE_SIZE`.

## Maintenance notes

- If a full-history view is ever built, the right shape is a `before=<day>`
  cursor on `series.json` — do not raise `MAX_SERIES_DAYS` to serve it.
