# Plan 066: Analytics page — make the data navigate somewhere, and say when it's stale

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/docs/components/analytics/ apps/docs/lib/release-notes.ts apps/docs/app/analytics/`
> Mismatch → re-read `ShareBars`, `SectionCards`, and `UsagePanel` before proceeding.

Found while sweeping `apps/docs` for interaction gaps after plan 064.

## Status

- **Priority:** P3
- **Effort:** S
- **Risk:** LOW — links and badges on a public read-only surface
- **Depends on:** none
- **Category:** UX / docs app
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

Three small disconnects on `/analytics`, all the same shape: the page presents
data that has a natural destination, then stops one step short of it.

### 066.1 — Version buckets don't link to their release pages

The "By version" breakdown (`share-bars.tsx`) renders version strings as plain
text rows. `/releases/<tag>` pages exist for every status — published gets
notes and checksums, withdrawn gets a warning banner, staged gets a preview.
`normalizeReleaseTag` already maps `0.3.0` → `v0.3.0` and `getReleaseByTag`
resolves all three statuses. The reader's obvious next question after "what
version is everyone on" is "what changed in it" — one `<Link>` closes that.

The residual bucket (`other`) must stay unlinked, and a version with no
release artifact renders as plain text — never a 404 link.

### 066.2 — "Reporting window" stat doesn't reach the table it describes

`SectionCards` renders `${points.length} days` + `from → to` as inert text.
The day-by-day card it summarizes sits lower on the same page. Give the table
card an `id` (`day-by-day`) and make the tile's value/headline an in-page
anchor link. One `href="#day-by-day"` — the stats row becomes navigation, not
just summary.

### 066.3 — No staleness signal on a page that claims freshness

`UsagePanel` prints `updated {formatUpdatedAt(metrics.updatedAt)}` as prose.
The ingest cron computes daily; if it dies, the page keeps serving the last
good snapshot with a stale timestamp that reads identical to a fresh one —
ISR means it looks alive forever. On a page whose pitch is trust, an honest
staleness marker is worth a badge: if `updatedAt` is older than ~48h, append
a muted "data may be stale" note (not an error — the last honest snapshot is
still the right thing to show, it just shouldn't masquerade as current).

Threshold lives next to `formatUpdatedAt` in `usage-panel.tsx`; 48h is
proposed because the cron is daily and a missed single run should not alarm —
two missed runs should.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `bun run --cwd apps/docs test` | all pass |
| Docs build | `bun run --cwd apps/docs build` | exits 0 |
| Full gates | `bun run typecheck --force && bun run test --force` | exit 0 |

## Scope

**In scope:**
- `apps/docs/components/analytics/share-bars.tsx` (version rows → links)
- `apps/docs/components/analytics/section-cards.tsx` + `trend-section.tsx`
  (anchor + id)
- `apps/docs/components/analytics/usage-panel.tsx` (staleness badge)
- Tests: `apps/docs/test/`

**Out of scope:**
- The share-over-time *legend* — linking legend items is fiddly for little
  gain; the bars are the comparison surface. Revisit only if 066.1 lands well.
- Ingest-side changes — staleness is derived from the existing `updatedAt`.
- `apps/docs/components/ui/separator.tsx` has zero consumers — dead primitive;
  worth deleting in the same PR but it is a cleanup note, not a deliverable.

## Steps

### Step 1: Linkable version rows

In `ShareRow`, when `bucket.residual` is false and
`getReleaseByTag(bucket.label)` returns an artifact, wrap the label in
`<Link href={releasePath(bucket.label)}>` with a subtle hover affordance —
the row's `th` keeps its semantics; the link is inside it. Residual and
unknown versions stay text.

**Verify:** unit test — a `byVersion` map with `0.3.0` renders a link to
`/releases/v0.3.0`; `other` renders none; an unmapped version renders none.

### Step 2: Anchor the window tile to the table

`trend-section.tsx`: `<Card id="day-by-day">` (or a wrapper `section id`).
`section-cards.tsx`: wrap the Reporting window tile's value/headline in
`<Link href="#day-by-day">`. Keyboard-focusable by default; no JS needed.

### Step 3: Staleness badge

In `UsagePanel`'s snapshot line: `const stale = Date.now() - Date.parse(metrics.updatedAt) > 48 * 3_600_000` → append `<Badge variant="outline">stale</Badge>`
plus a muted "(last computed X)" qualifier. Keep it `warn`-toned, not `danger`.

**Verify:** test with a fixed `updatedAt` 3 days old → badge present; 1 hour
old → absent.

## Test plan

- New: version-bucket link rendering (hit, residual miss, unknown-version miss).
- New: staleness badge threshold both sides.
- Regression: `usage-panel.test.tsx` still green; SSR output unchanged in
  shape for the non-linked cases.

## Done criteria

- [ ] Version rows deep-link to `/releases/<tag>` when an artifact exists
- [ ] Reporting-window tile anchors to `#day-by-day`
- [ ] Snapshots older than 48h display a stale badge
- [ ] `bun run --cwd apps/docs test` exits 0

## STOP conditions

- `share-bars.tsx` was restructured (e.g. to a real chart lib) — the link
  logic still applies wherever the label renders.
- Release artifacts stop carrying all three statuses — the link predicate
  must be re-derived; never link a tag that has no page.

## Maintenance notes

- If the ingest cadence ever moves off daily, the 48h threshold is the only
  number to revisit.
