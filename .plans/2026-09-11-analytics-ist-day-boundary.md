# Analytics day boundary: UTC to IST

Status: proposed
Owner: unassigned
Target: `apps/analytics-ingest` + `apps/docs` deploys (not tied to a CLI release)

Move the analytics "day" from midnight UTC to midnight IST so the newest complete
day publishes around 00:30 IST instead of 05:35 IST, and show each viewer the
update time in their own clock. Stacks on the cron diagnostics change
(`fix/analytics-cron-diagnostics`), which rewrites the same handler.

---

## What the code already fixes in place

Each of these was read from source, not inferred.

- **The day is decided server-side, once.** `apps/analytics-ingest/src/ingest.ts`
  assigns `day` from the server clock (`utcDayKey(now)`); the client `ts` only
  feeds `isTimestampSkewed`. Published CLI binaries never choose a day, so the
  immutable-binary hazard does not apply.
- **The database never decides the day.** Every statement in
  `apps/analytics-ingest/src/postgres-store.ts` takes it as `$1::date` from the
  app, and `install_lifetime.first_seen` / `last_seen` are day labels written
  from that same value. No SQL reads `now()` or `current_date` to pick a day.
  The change is therefore entirely in application code.
- **Three clocks answer "what day is it" independently** and must never
  disagree: `utcDayKey` (ingest), `snapshotDayKey` in `src/public-metrics.ts`
  (the cron, `daily.ts`, `series.ts`, `admin.ts`), and an inline `today` in
  `api/cron/snapshot.ts`. If ingest and the cron ever disagree, the cron rolls
  up a day that holds no rows.
- **Label arithmetic is already boundary-agnostic.** `dayKeyBefore` and
  `seriesStartDay` shift `YYYY-MM-DD` strings by whole days and never read a
  clock. They stay as they are.
- **History cannot be rebuilt in IST.** `ping_day.first_seen` records only the
  first ping per install per _UTC_ day — the `(day, install_hash)` primary key
  discarded the rest. An install active at 23:00 IST and again at 01:00 IST
  shares one UTC day, so its 01:00 ping was never stored. An IST rebuild of the
  35-day raw window would systematically undercount exactly the installs
  active near the new boundary, and `daily_rollup` rows older than that carry
  no per-ping time at all.
- **The docs site rejects any wire change.** `parseDocsAnalyticsMetrics` in
  `apps/docs/lib/analytics-metrics.ts` requires exactly eight keys and
  `schemaVersion === 2`, returning `null` otherwise. A new field or a version
  bump would silently empty the analytics panel.
- **Vercel runs crons in UTC with no timezone setting**, and on Hobby "a job
  scheduled for a specific hour may trigger at any point within that hour"
  (Vercel docs, _Cron Jobs: usage and pricing_). The current `5 0 * * *` job
  last ran at 00:27 UTC, which is consistent with Hobby. The plan was not
  verified from the repo.

## Decisions

| Decision                      | Choice                                                               | Why                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Zone                          | Fixed `+05:30`                                                       | India observes no DST, so a fixed offset is exactly `Asia/Kolkata` with no timezone-database dependency |
| Wire                          | Unchanged — eight keys, `schemaVersion: 2`, `day` stays `YYYY-MM-DD` | The docs site's exact-key parser keeps working; one deploy, nothing breaks                              |
| Where the change is announced | The privacy contract and the user privacy doc                        | The wire does not carry it, so the docs must                                                            |
| Cutover                       | A named constant at an exact IST midnight                            | The seam lands on a known date regardless of when the PR merges                                         |
| History                       | Kept verbatim in UTC                                                 | A rebuild would write biased numbers into the permanent record                                          |
| Viewer-local                  | The `updatedAt` instant only                                         | Aggregated day buckets cannot be re-cut along a viewer's own midnight                                   |
| Caches                        | Unchanged                                                            | `s-maxage` and ISR `revalidate` are cost controls; changing them is its own contract change             |

Rejected: an environment-variable offset. It is a configuration knob for a value
that should never change, it can drift between preview and production, and
changing it later would cut a second seam.

## Design

### The day clock

New module `apps/analytics-ingest/src/analytics-day.ts`, the only place that
turns an instant into a day label:

```ts
/** First instant whose day is labelled in IST. An exact IST midnight. */
export const IST_DAY_BOUNDARY_FROM = Date.parse("2026-09-14T18:30:00.000Z");

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Label of the day containing `now`: UTC before the cutover, IST from it. */
export function analyticsDayKey(now: number): string;

/** Label of the most recent *complete* day — the one the cron publishes. */
export function previousAnalyticsDayKey(now: number): string;
```

`previousAnalyticsDayKey` is `analyticsDayKey(now)` minus one day in label space,
so it is correct on both sides of the seam: at `2026-09-14T19:00Z` the current
day is `2026-09-15` (IST) and the previous is `2026-09-14`, the seam day.

Callers move to it:

- `ingest.ts` — `utcDayKey` is removed; `ingestAnalyticsPing` calls
  `analyticsDayKey`. The name would be false after the cutover. Two tests
  import it and move to `analyticsDayKey`:
  `apps/analytics-ingest/test/ingest.test.ts` and the cross-app
  `apps/cli/test/integration/analytics-wire-contract.test.ts`. Both pin
  `NOW = Date.UTC(2026, 7, 14, 12)` — 14 August, before the cutover — so
  their expected values are unchanged by the rename.
- `public-metrics.ts` — `snapshotDayKey` becomes a re-export of
  `previousAnalyticsDayKey` so `daily.ts`, `series.ts` and `admin.ts` need no
  edit. Kept as a name because three endpoints already speak it.
- `api/cron/snapshot.ts` — the inline `today` becomes `analyticsDayKey(now)`.

### The seam

With the cutover at `2026-09-14T18:30:00Z` (00:00 IST on 15 September):

| Label        | Covers          | Length                    |
| ------------ | --------------- | ------------------------- |
| `2026-09-13` | 00:00–24:00 UTC | 24 h                      |
| `2026-09-14` | 00:00–18:30 UTC | **18.5 h — the seam day** |
| `2026-09-15` | 00:00–24:00 IST | 24 h, first IST day       |

Labels never move backwards across the seam, because an IST label is never
earlier than the UTC label for the same instant. The `(day, install_hash)` key,
`ingest_budget`, retention by label, and `first_seen <= day` all keep working
unchanged. The seam day's `activeInstalls` reads lower than its neighbours; that
is correct data and is documented, not corrected.

### Viewer-local time on the docs site

`apps/docs/components/analytics/usage-panel.tsx` renders `updated … UTC` on the
server, so any "local" time there would be the server's. A small client
component replaces that one span:

- the server renders `<time dateTime={iso}>` containing the UTC string, which is
  also the no-JavaScript fallback;
- after mount, it swaps the text to the viewer's clock with
  `Intl.DateTimeFormat`, so server and client HTML match at hydration.

`updatedAt` arrives as Postgres text (`2026-09-10 00:27:00.766999+00`). That
parses in JavaScriptCore and V8 but is not ISO 8601, and parsing non-ISO strings
is implementation-defined. The server normalises it with `toISOString()` before
it reaches the client, so no engine is ever asked to parse the Postgres form.

A static caption, true on both sides of the seam:
_"Days end at midnight IST (18:30 UTC) from 15 September 2026; earlier days end
at midnight UTC."_

The day label renders on three surfaces, each decided:

| Surface                                                          | Shows            | Change                                                         |
| ---------------------------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| `usage-panel.tsx` — "Snapshot day", and the zero-day empty state | day, `updatedAt` | Caption here, once for the page; `updatedAt` becomes local     |
| `section-cards.tsx` — "Distinct installs on …"                   | day              | None; it sits on the same `/analytics` page the caption covers |
| `home/usage-line.tsx` — home teaser                              | day              | None; a one-line teaser that links to `/analytics`             |

`updatedAt` renders only in `usage-panel.tsx`, so the local-time component
is needed there alone.

## Rollout — two steps

**Step 1 — this change.** The day clock, the docs-site time and caption, and the
docs. The cron schedule is **not** touched. It is inert until the cutover
instant, then relabels new pings as IST on its own. The existing `5 0 * * *` run
keeps publishing at about 05:35 IST, exactly as it does today, and after the
cutover it publishes the just-closed IST day. **Merge any time before
`2026-09-14T18:30:00Z`.** If that date is missed, move the constant to a later
IST midnight before merging, never to a past one.

**Step 2 — follow-up.** `apps/analytics-ingest/vercel.json`: `5 0 * * *` →
`0 19 * * *`. **Merge any time after the cutover.** From then on the newest day
publishes at 00:30–01:29 IST on Hobby, or 00:30 IST on Pro.

Why the schedule cannot ship with step 1: before the cutover the labels are
still UTC, and a 19:00 UTC run can only roll up UTC-_yesterday_, 19 hours after
it closed rather than half an hour. Every day between merge and cutover would
publish roughly 19 hours staler than it does now. Hour 19 rather than hour 18,
because IST closes at 18:30 UTC and Hobby may fire anywhere within the
scheduled hour — an hour-18 schedule would run before the day closes about
half the time.

Neither step changes the wire, so `apps/docs` and `apps/analytics-ingest` can
deploy in either order.

## What a viewer should expect

The newest day publishes at the cron, then passes two caches: the JSON's
`s-maxage=3600` at the CDN and the analytics page's ISR `revalidate = 3600`. In
the worst case the docs page shows a new day about two hours after the cron
ran. Tightening that is a separate cost-control change.

## Tests

Clocks are anchored to `IST_DAY_BOUNDARY_FROM` itself, never to a separately
written date.

- `analytics-day`: one millisecond before the cutover labels UTC; the cutover
  instant labels the next IST day; `18:30Z` on an ordinary post-cutover day
  rolls over; the constant is an exact IST midnight; labels are
  non-decreasing across a sweep of instants spanning the seam.
- `previousAnalyticsDayKey`: at `19:00Z` after the cutover it returns the
  just-closed IST day; at `00:05Z` before the cutover it returns UTC-yesterday,
  matching today's behaviour.
- Ingest: a ping at each side of the cutover lands on the expected label.
- Cron: the snapshot day at `19:00Z` post-cutover is the just-closed IST day.
- Docs: the local-time component renders the UTC fallback on the server, and
  the normaliser turns the Postgres form into strict ISO.

## Documentation

Updated together, as the contract's last line requires:

- `.docs/analytics-privacy-contract.md` — the boundary, the cutover instant, the
  seam day, why history is not rebuilt, and the two-step rollout.
- `docs/users/reliability-and-privacy.mdx` — days end at midnight IST from
  15 September 2026; "updated" is shown in your own time; days are not
  re-cut to your local midnight.

The phrases pinned by `apps/cli/test/unit/architecture/analytics-payload-drift.test.ts`
stay intact.

## Out of scope

- Re-labelling or rebuilding any existing data.
- Changing the CDN or ISR cache lifetimes.
- A per-viewer day bucket, which aggregates cannot support.
- Any change to the client ping or its payload.

## Risks

| Risk                                              | Effect                                                             | Mitigation                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Step 1 merged after the cutover instant           | The switch happens at deploy time and can leave two irregular days | Move the constant to a future IST midnight before merging                   |
| Step 2 merged before the cutover                  | Pre-cutover days publish ~19 hours staler until the cutover passes | Merge order stated here and in the step 2 PR; nothing is lost, only delayed |
| A consumer outside the docs site assumed UTC days | Their reading shifts by 5.5 hours from the cutover                 | The wire cannot announce it; both docs state the boundary and the date      |
