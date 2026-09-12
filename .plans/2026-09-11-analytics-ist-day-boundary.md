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
- **History cannot be rebuilt in IST.** The `(day, install_hash)` primary key
  keeps the first row of a UTC day and discards the retry, so `first_seen`
  stamps only that first ping per install per _UTC_ day — the later one's time
  was never written. It records only the
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

`updatedAt` arrives as Postgres text (`2026-09-11 00:27:00.82757+00`). That
parses in JavaScriptCore and V8 but is not ISO 8601, and parsing non-ISO strings
is implementation-defined, so the client must never see that form.

Normalisation belongs in `parseDocsAnalyticsMetrics`
(`apps/docs/lib/analytics-metrics.ts`), which already validates `updatedAt` and
is the I/O boundary every consumer passes through. It must not go in the client
component, which would reintroduce the engine-dependent parse it exists to
remove. `toISOString()` throws `RangeError` on an unparseable value, so the
normaliser returns the original string unchanged rather than throwing — a
malformed timestamp must not blank the analytics panel.

Worth knowing: every docs test fixture already uses strict ISO
(`2026-08-14T00:05:00.000Z`) while production sends the Postgres form. That gap
is why the difference went unnoticed, and the normaliser's tests close it.

A static caption, true on both sides of the seam:
_"Days end at midnight IST (18:30 UTC) from 15 September 2026; earlier days end
at midnight UTC."_

The day label renders in four families, each decided:

| Surface                                                                                | Shows            | Change                                                         |
| -------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| `usage-panel.tsx` — "Snapshot day", and the zero-day empty state                       | day, `updatedAt` | Caption here, once for the page; `updatedAt` becomes local     |
| `section-cards.tsx` — "Distinct installs on …"                                         | day              | None; it sits on the same `/analytics` page the caption covers |
| `home/usage-line.tsx` — home teaser                                                    | day              | None; a one-line teaser that links to `/analytics`             |
| `trend-section.tsx` / `chart-installs.tsx` — per-point rows, x-axis ticks, `from → to` | day              | None; same `/analytics` page, covered by the caption           |

`updatedAt` renders only in `usage-panel.tsx`, so the local-time component
is needed there alone.

## Rollout — two steps

**Step 1 — this change.** The day clock, the docs-site time and caption, and the
docs. The cron schedule is **not** touched. It is inert until the cutover
instant, then relabels new pings as IST on its own. The existing `5 0 * * *` run
keeps publishing at about 05:35 IST, exactly as it does today, and after the
cutover it publishes the just-closed IST day. **It must be deployed to
production and verified there at least 24 hours before
`2026-09-14T18:30:00Z`** — merging is not the gate, because the constant is
evaluated per request and a rollout still in progress at the boundary would let
two versions label the same instant differently, producing the two irregular
days the fixed constant exists to prevent. "Verified" means the production
deployment's git commit contains `apps/analytics-ingest/src/analytics-day.ts` —
before the cutover the old and new clocks behave identically by design, so the
commit is the only thing that can prove it. If the deploy lands inside that
window, follow _Moving the cutover_ below.

**Moving the cutover.** Pick a later instant ending in `T18:30:00.000Z` — an
exact IST midnight — at least 24 hours after a deploy you can verify. Never an
earlier one. Then change every reference to the date in the same commit:

| Reference                                        | What names the date                                      | Enforced by                                                       |
| ------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/analytics-ingest/src/analytics-day.ts`     | `IST_DAY_BOUNDARY_FROM` — the source of truth            | —                                                                 |
| `apps/docs/components/analytics/usage-panel.tsx` | the caption: first IST day and changeover day            | `apps/docs/test/usage-panel.test.tsx`                             |
| `.docs/analytics-privacy-contract.md`            | the ISO instant, the first IST day, the changeover label | `apps/cli/test/unit/architecture/analytics-payload-drift.test.ts` |
| `docs/users/reliability-and-privacy.mdx`         | the first IST day and the changeover day                 | the same drift test                                               |
| `apps/docs/lib/generated-metadata.json`          | a fingerprint of the user doc                            | CI's codegen-freshness check                                      |
| This spec's seam table and worked examples       | illustrative dates                                       | nobody — update by hand                                           |

`apps/analytics-ingest/test/analytics-day.test.ts` needs no edit: every clock and
expected label there is derived from the constant. The caption and document
tests derive their expected dates from the constant too, so moving it without
moving them fails loudly instead of shipping a page that names the wrong day.

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
- Docs: the local-time component renders the UTC fallback on the server; the
  normaliser turns the Postgres form into strict ISO and returns an
  unparseable value untouched instead of throwing.
- The three read endpoints under a pinned clock: `daily.ts`, `series.ts` and
  `admin.ts` call `snapshotDayKey()` with no argument, so their day is
  currently untestable. Give them an injectable clock (or a test-only export)
  and assert each resolves the expected day on both sides of the cutover.
- A caption assertion, so the boundary sentence cannot be deleted silently —
  the payload-drift gate does not pin it.

## Documentation

Updated together, as the contract's last line requires:

- `.docs/analytics-privacy-contract.md` — the boundary, the cutover instant, the
  seam day, why history is not rebuilt, and the two-step rollout. Also that
  retention cutoffs are computed from the same day labels they compare
  against, so around the seam a row can be held at most one extra day —
  the safe direction, and storage only.
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

| Risk                                              | Effect                                                                                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 merged after the cutover instant           | The switch happens at deploy time and can leave two irregular days                                                                                                                                 | Move the constant to a future IST midnight before merging                                                                                                                                                                                                                             |
| Step 2 merged before the cutover                  | Pre-cutover days publish ~19 hours staler until the cutover passes                                                                                                                                 | Merge order stated here and in the step 2 PR; publication is delayed, not lost                                                                                                                                                                                                        |
| Step 1 reverted after the cutover                 | Labels move backwards: a ping at 20:00 UTC on 15 September would be labelled `2026-09-15`, a day that already exists as a closed IST day, and the next cron run recomputes it with the extra hours | Fix forward once the cutover has passed. Revert only before it. Any revert must move ingest and cron together — reverting one side leaves the cron rolling up a day that holds no rows, and a full revert overwrites the closed IST rollup through the `on conflict do update` upsert |
| A consumer outside the docs site assumed UTC days | Their reading shifts by 5.5 hours from the cutover                                                                                                                                                 | The wire cannot announce it; both docs state the boundary and the date                                                                                                                                                                                                                |

---

# Implementation

> **Executor instructions**: Work top to bottom. Every task ends green and
> committed. Run `bun run test`, never `bun test`. A root gate can be a turbo
> cache replay — pass `--force` before believing it. STOP and report rather than
> inventing a fix if a verify step fails for a reason this plan does not name.

Branch `feat/analytics-ist-day-boundary`, stacked on `fix/analytics-cron-diagnostics`
(PR #362). Tasks 1–7 are step 1 of the rollout. Task 8 is step 2 and is a
**separate PR merged after the cutover**.

**Status: tasks 1–7 are implemented on this branch and checked below.** Only
task 8 remains, and it cannot start until the cutover has passed and the IST
clock is proven live in production.

Note for anyone re-running the verify steps: only `apps/cli` defines a
`test:file` script. `apps/analytics-ingest` and `apps/docs` run their whole
suite with `bun run test`, which is what the steps below use.

## Global constraints

- The public JSON keeps exactly its eight keys at `schemaVersion: 2`, and `day`
  keeps the `YYYY-MM-DD` shape. `parseDocsAnalyticsMetrics` rejects anything
  else and the panel goes blank.
- `IST_DAY_BOUNDARY_FROM` is `2026-09-14T18:30:00.000Z`. Every clock in a test
  is expressed relative to that constant, never as a separately typed date.
- No new day-label clock. Every instant becomes a label through
  `analytics-day.ts`.
- `apps/analytics-ingest/vercel.json` is **not** edited before Task 8.

## File structure

| File                                                                            | Responsibility                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/analytics-ingest/src/analytics-day.ts`                                    | **New.** The only instant → day-label conversion           |
| `apps/analytics-ingest/test/analytics-day.test.ts`                              | **New.** Cutover, seam, monotonicity, parity               |
| `apps/analytics-ingest/src/ingest.ts`                                           | Drops `utcDayKey`; labels through the new module           |
| `apps/analytics-ingest/src/public-metrics.ts`                                   | `snapshotDayKey` becomes a re-export                       |
| `apps/analytics-ingest/api/cron/snapshot.ts`                                    | Inline `today` and `dayKeyBefore` route through the module |
| `apps/analytics-ingest/test/no-second-day-clock.test.ts`                        | **New.** Guards the single-clock invariant                 |
| `apps/docs/lib/analytics-metrics.ts`                                            | Normalises `updatedAt` to strict ISO at the I/O boundary   |
| `apps/docs/components/analytics/local-time.tsx`                                 | **New.** Client component; UTC fallback, local after mount |
| `apps/docs/components/analytics/usage-panel.tsx`                                | Uses `LocalTime`; adds the boundary caption                |
| `.docs/analytics-privacy-contract.md`, `docs/users/reliability-and-privacy.mdx` | The boundary, the cutover, the seam                        |

---

## Task 1: The day clock

**Files:**

- Create: `apps/analytics-ingest/src/analytics-day.ts`
- Create: `apps/analytics-ingest/test/analytics-day.test.ts`

**Produces:** `IST_DAY_BOUNDARY_FROM: number`, `analyticsDayKey(now?: number): string`,
`previousAnalyticsDayKey(now?: number): string`, `shiftDayKey(day: string, days: number): string`.

- [x] **Step 1: Write the failing test**

```ts
// apps/analytics-ingest/test/analytics-day.test.ts
import { describe, expect, test } from "bun:test";

import {
  analyticsDayKey,
  IST_DAY_BOUNDARY_FROM,
  previousAnalyticsDayKey,
  shiftDayKey,
} from "../src/analytics-day";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const IST_OFFSET_MS = (5 * 60 + 30) * MINUTE_MS;

describe("analyticsDayKey", () => {
  test("the cutover is an exact IST midnight", () => {
    // If this drifts, the seam stops being a single short day.
    expect(new Date(IST_DAY_BOUNDARY_FROM + IST_OFFSET_MS).toISOString()).toEndWith(
      "T00:00:00.000Z",
    );
  });

  test("one millisecond before the cutover still labels in UTC", () => {
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM - 1)).toBe("2026-09-14");
  });

  test("the cutover instant opens the first IST day", () => {
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM)).toBe("2026-09-15");
  });

  test("an IST day rolls over at 18:30 UTC, not midnight UTC", () => {
    const lastInstant = Date.parse("2026-09-20T18:29:59.999Z");
    expect(analyticsDayKey(lastInstant)).toBe("2026-09-20");
    expect(analyticsDayKey(lastInstant + 1)).toBe("2026-09-21");
  });

  test("labels never move backwards across the seam", () => {
    let previous = "";
    for (
      let t = IST_DAY_BOUNDARY_FROM - 8 * HOUR_MS;
      t <= IST_DAY_BOUNDARY_FROM + 8 * HOUR_MS;
      t += 5 * MINUTE_MS
    ) {
      const label = analyticsDayKey(t);
      expect(label >= previous).toBe(true);
      previous = label;
    }
  });

  test("the seam day is the short one", () => {
    // 2026-09-14 runs 00:00Z to 18:30Z only: 18.5 hours, not 24.
    expect(analyticsDayKey(Date.parse("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM - 1)).toBe("2026-09-14");
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM)).toBe("2026-09-15");
  });
});

describe("previousAnalyticsDayKey", () => {
  test("at 19:00 UTC after the cutover it returns the just-closed IST day", () => {
    expect(previousAnalyticsDayKey(Date.parse("2026-09-15T19:00:00Z"))).toBe("2026-09-15");
  });

  test("the first post-cutover run publishes the seam day", () => {
    expect(previousAnalyticsDayKey(Date.parse("2026-09-14T19:00:00Z"))).toBe("2026-09-14");
  });

  test("before the cutover it matches the now-minus-24h formula it replaces", () => {
    // The behaviour the old snapshotDayKey had, so nothing shifts before the seam.
    for (const instant of [
      Date.parse("2026-08-14T00:05:00Z"),
      Date.parse("2026-08-14T23:59:59Z"),
      IST_DAY_BOUNDARY_FROM - HOUR_MS,
    ]) {
      const legacy = new Date(instant - 24 * HOUR_MS).toISOString().slice(0, 10);
      expect(previousAnalyticsDayKey(instant)).toBe(legacy);
    }
  });
});

describe("shiftDayKey", () => {
  test("moves whole days without reading a clock", () => {
    expect(shiftDayKey("2026-09-15", -35)).toBe("2026-08-11");
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `cd apps/analytics-ingest && bun run test`
Expected: FAIL — cannot resolve `../src/analytics-day`.

- [x] **Step 3: Write the module**

```ts
// apps/analytics-ingest/src/analytics-day.ts
/**
 * The one place an instant becomes a day label.
 *
 * Ingest, the cron and the public read endpoints all have to agree on what day
 * it is. They used to answer separately — `utcDayKey`, `snapshotDayKey`, and an
 * inline `today` in the cron — and a disagreement between them means the cron
 * rolls up a day that holds no rows. All three route through here.
 */

/**
 * The first instant labelled in IST: 00:00 IST on 15 September 2026, which is
 * 18:30 UTC on the 14th. Before it, labels are UTC; from it, IST.
 *
 * This must stay an exact IST midnight, and must be in the future when the
 * change is deployed. A deploy that lands after it relabels at deploy time
 * instead, and a revert past it moves labels backwards into a day that is
 * already closed. Both are in the plan's risk table.
 */
export const IST_DAY_BOUNDARY_FROM = Date.parse("2026-09-14T18:30:00.000Z");

/** India observes no DST, so a fixed offset is exactly `Asia/Kolkata`. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Label of the day containing `now`. */
export function analyticsDayKey(now: number = Date.now()): string {
  const shifted = now >= IST_DAY_BOUNDARY_FROM ? now + IST_OFFSET_MS : now;
  return new Date(shifted).toISOString().slice(0, 10);
}

/**
 * Label of the most recent complete day — the one the cron publishes and the
 * public endpoints read.
 *
 * Stepping back one label rather than 24 hours of wall clock is what makes this
 * right across the seam, where the day before a 24-hour IST day is an
 * 18.5-hour one.
 */
export function previousAnalyticsDayKey(now: number = Date.now()): string {
  return shiftDayKey(analyticsDayKey(now), -1);
}

/** Shift a `YYYY-MM-DD` label by whole days. Pure arithmetic; reads no clock. */
export function shiftDayKey(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
```

- [x] **Step 4: Run it and confirm it passes**

Run: `cd apps/analytics-ingest && bun run test`
Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

```bash
git add apps/analytics-ingest/src/analytics-day.ts apps/analytics-ingest/test/analytics-day.test.ts
git commit -m "feat(analytics): add the single day-label clock"
```

---

## Task 2: Ingest labels through the clock

**Files:**

- Modify: `apps/analytics-ingest/src/ingest.ts` (remove `utcDayKey`, line 67)
- Modify: `apps/analytics-ingest/test/ingest.test.ts:11,69,85,100`
- Modify: `apps/cli/test/integration/analytics-wire-contract.test.ts:9,96,115,128,148`

**Consumes:** `analyticsDayKey` from Task 1.

- [x] **Step 1: Add the failing test to `apps/analytics-ingest/test/analytics-day.test.ts`**

```ts
import { ingestAnalyticsPing } from "../src/ingest";
import { createMemoryAnalyticsStore } from "../src/memory-store";

describe("ingest labels through the shared clock", () => {
  async function ingestAt(now: number) {
    const store = createMemoryAnalyticsStore();
    const result = await ingestAnalyticsPing({
      method: "POST",
      hashSecret: "test-secret",
      store,
      now,
      body: {
        installId: "11111111-2222-4333-8444-555555555555",
        version: "0.3.0",
        os: "linux",
        arch: "x64",
        ts: now,
      },
    });
    return result;
  }

  test("a ping just before the cutover lands on the UTC label", async () => {
    const result = await ingestAt(IST_DAY_BOUNDARY_FROM - 1);
    expect(result).toMatchObject({ ok: true, day: "2026-09-14" });
  });

  test("a ping at the cutover lands on the first IST label", async () => {
    const result = await ingestAt(IST_DAY_BOUNDARY_FROM);
    expect(result).toMatchObject({ ok: true, day: "2026-09-15" });
  });
});
```

- [x] **Step 2: Run it and confirm the second case fails**

Run: `cd apps/analytics-ingest && bun run test`
Expected: FAIL — the cutover ping still reports `2026-09-14`, because ingest
still uses `utcDayKey`. If the import of `createMemoryAnalyticsStore` fails,
check its exported name in `src/memory-store.ts` and use that instead; do not
change the store.

- [x] **Step 3: Route ingest through the clock**

In `apps/analytics-ingest/src/ingest.ts`, delete this function entirely:

```ts
export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}
```

Add to the imports at the top of the file:

```ts
import { analyticsDayKey } from "./analytics-day.js";
```

And change the one call site (line 132):

```ts
const day = analyticsDayKey(now);
```

- [x] **Step 4: Update the two tests that imported the removed function**

In `apps/analytics-ingest/test/ingest.test.ts` and
`apps/cli/test/integration/analytics-wire-contract.test.ts`, replace the
`utcDayKey` import with `analyticsDayKey` from
`apps/analytics-ingest/src/analytics-day`, and rename every call.

Both files pin `NOW = Date.UTC(2026, 7, 14, 12, 0, 0)` — 14 August, before the
cutover — so `analyticsDayKey(NOW)` returns exactly what `utcDayKey(NOW)` did
and no expected value changes.

- [x] **Step 5: Verify**

```bash
cd apps/analytics-ingest && bun run test
cd ../.. && bun run --cwd apps/cli test:file -- test/integration/analytics-wire-contract.test.ts
grep -rn "utcDayKey" apps packages --include='*.ts' | grep -v node_modules
```

Expected: both suites PASS; the grep prints nothing.

- [x] **Step 6: Commit**

```bash
git add apps/analytics-ingest/src/ingest.ts apps/analytics-ingest/test apps/cli/test/integration/analytics-wire-contract.test.ts
git commit -m "refactor(analytics): label ingest through the shared day clock"
```

---

## Task 3: The read side and the cron

**Files:**

- Modify: `apps/analytics-ingest/src/public-metrics.ts:184-187`
- Modify: `apps/analytics-ingest/api/cron/snapshot.ts:22-24,76,114,144,158`

**Consumes:** `previousAnalyticsDayKey`, `analyticsDayKey`, `shiftDayKey`.

`snapshotDayKey` is only declared in `public-metrics.ts`, never called inside it,
and `daily.ts`, `series.ts` and `admin.ts` import it by name — so re-exporting
under the same name moves all three with no edit.

- [x] **Step 1: Add the failing test to `apps/analytics-ingest/test/analytics-day.test.ts`**

```ts
import { snapshotDayKey } from "../src/public-metrics";

describe("snapshotDayKey follows the shared clock", () => {
  test("it is the same function the cron and the endpoints use", () => {
    expect(snapshotDayKey(Date.parse("2026-09-15T19:00:00Z"))).toBe("2026-09-15");
    expect(snapshotDayKey(IST_DAY_BOUNDARY_FROM - 1)).toBe("2026-09-13");
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `cd apps/analytics-ingest && bun run test`
Expected: FAIL — the old `now - 24h` implementation returns `2026-09-14` for the
first case.

- [x] **Step 3: Re-export in `public-metrics.ts`**

Replace the function at the end of the file:

```ts
/** Prefer yesterday's rollup for the public "active installs" line. */
export function snapshotDayKey(now = Date.now()): string {
  return new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
```

with a re-export, so there is one implementation:

```ts
/**
 * The most recent complete day — what the public "active installs" line shows.
 * Kept under this name because three endpoints already import it.
 */
export { previousAnalyticsDayKey as snapshotDayKey } from "./analytics-day.js";
```

- [x] **Step 4: Route the cron's own clock and drop its local arithmetic**

In `apps/analytics-ingest/api/cron/snapshot.ts`, delete the local helper:

```ts
function dayKeyBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}
```

Delete the now-unused `const DAY_MS = 24 * 60 * 60 * 1000;`, and import instead:

```ts
import { analyticsDayKey, shiftDayKey } from "../../src/analytics-day.js";
```

Replace the inline today (line 114):

```ts
const today = analyticsDayKey(now);
```

and the three `dayKeyBefore` calls, which invert to a negative shift:

```ts
const missed = await store.findDaysNeedingRollup(shiftDayKey(today, -RAW_RETENTION_DAYS), target);
```

```ts
pruned = await runtime.store.pruneRawBefore(shiftDayKey(today, -RAW_RETENTION_DAYS));
```

```ts
retired = (await runtime.store.pruneLifetimeBefore(shiftDayKey(today, -retention))).retired;
```

- [x] **Step 5: Verify**

```bash
cd apps/analytics-ingest && bun run test
cd ../.. && bun run typecheck --force
```

Expected: all PASS; typecheck exits 0.

- [x] **Step 6: Commit**

```bash
git add apps/analytics-ingest/src/public-metrics.ts apps/analytics-ingest/api/cron/snapshot.ts apps/analytics-ingest/test/analytics-day.test.ts
git commit -m "refactor(analytics): read and roll up through the shared day clock"
```

---

## Task 4: One implementation of label arithmetic, and a guard

The design holds only while `analytics-day.ts` is the sole place an instant
becomes a label. Two files still do their own `YYYY-MM-DD` arithmetic, and a
fourth clock added later would fail no existing test — so both get folded in and
the invariant gets a guard.

**Files:**

- Modify: `apps/analytics-ingest/src/public-series.ts:146-150`
- Modify: `apps/analytics-ingest/api/metrics/admin.ts:39-42`
- Create: `apps/analytics-ingest/test/no-second-day-clock.test.ts`

**Consumes:** `shiftDayKey` from Task 1.

- [x] **Step 1: Fold `seriesStartDay` onto the shared helper**

In `apps/analytics-ingest/src/public-series.ts`, replace the body — it is the
same whole-day shift, written a second time:

```ts
/** The inclusive start day for a window of `days` ending on `endDay`. */
export function seriesStartDay(endDay: string, days: number): string {
  return shiftDayKey(endDay, -(days - 1));
}
```

with `import { shiftDayKey } from "./analytics-day.js";` at the top.

- [x] **Step 2: Fold the admin window onto it too**

In `apps/analytics-ingest/api/metrics/admin.ts`, replace:

```ts
const from = new Date(Date.parse(`${to}T00:00:00Z`) - (ADMIN_WINDOW_DAYS - 1) * 86_400_000)
  .toISOString()
  .slice(0, 10);
```

with:

```ts
const from = shiftDayKey(to, -(ADMIN_WINDOW_DAYS - 1));
```

and import `shiftDayKey` from `../../src/analytics-day.js`.

- [x] **Step 3: Verify nothing moved**

Run: `cd apps/analytics-ingest && bun run test`
Expected: PASS. These already pin `seriesStartDay`; if a boundary shifts by a
day the replacement is not equivalent — stop and report rather than editing
the expectations.

- [x] **Step 4: Write the guard**

The guard lives in `apps/analytics-ingest/test/no-second-day-clock.test.ts`; the
file is the authority, so its code is not repeated here. It scans `src/` and
`api/` for every common way to derive a calendar day from a `Date` — cutting an
ISO string, reading or setting calendar fields, locale date formatting — on
whitespace-stripped source, and table-tests its own matcher against each form
and against what must stay allowed. The first version matched only
`toISOString().slice(0, 10)`, which `.split("T")[0]` or `getUTCDate()` would
have walked past. It is still a list, not a proof: a date library or a regex
over an ISO string would get past it, and belongs in `analytics-day.ts`.

- [x] **Step 5: Run it**

Run: `cd apps/analytics-ingest && bun run test`
Expected: PASS. A FAIL names the file that still derives its own label — route
it through `analyticsDayKey` or `shiftDayKey`. Do not add an exception.

- [x] **Step 6: Commit**

```bash
git add apps/analytics-ingest/src/public-series.ts apps/analytics-ingest/api/metrics/admin.ts apps/analytics-ingest/test/no-second-day-clock.test.ts
git commit -m "refactor(analytics): one implementation of day-label arithmetic"
```

---

## Task 5: Normalise the timestamp at the docs boundary

`updatedAt` arrives as Postgres text (`2026-09-11 00:27:00.82757+00`), which is
not ISO 8601. It parses in JavaScriptCore and V8, but engines are not required
to, so it is normalised at the one boundary every consumer passes through
rather than in the component that renders it.

**Files:**

- Modify: `apps/docs/lib/analytics-metrics.ts:96,105`
- Modify: `apps/docs/test/analytics-metrics.test.ts`

- [x] **Step 1: Write the failing test in `apps/docs/test/analytics-metrics.test.ts`**

```ts
describe("updatedAt normalisation", () => {
  const base = {
    schemaVersion: 2,
    day: "2026-09-10",
    activeInstalls: 11,
    lifetimeInstalls: 57,
    byVersion: { "0.3.0": 11 },
    byOs: { linux: 11 },
    byArch: { x64: 11 },
  };

  test("the Postgres form becomes strict ISO", () => {
    // What production actually sends. Every fixture in this repo used ISO, so
    // the difference went unnoticed.
    const parsed = parseDocsAnalyticsMetrics({
      ...base,
      updatedAt: "2026-09-11 00:27:00.82757+00",
    });
    expect(parsed?.updatedAt).toBe("2026-09-11T00:27:00.827Z");
  });

  test("an already-ISO value is unchanged", () => {
    const parsed = parseDocsAnalyticsMetrics({ ...base, updatedAt: "2026-09-11T00:27:00.827Z" });
    expect(parsed?.updatedAt).toBe("2026-09-11T00:27:00.827Z");
  });

  test("an unparseable value is kept verbatim rather than throwing", () => {
    // toISOString throws RangeError on an invalid date; a malformed timestamp
    // must not blank the whole panel.
    const parsed = parseDocsAnalyticsMetrics({ ...base, updatedAt: "not a timestamp" });
    expect(parsed?.updatedAt).toBe("not a timestamp");
  });
});
```

- [x] **Step 2: Run it and confirm the first case fails**

Run: `cd apps/docs && bun run test`
Expected: FAIL — `updatedAt` comes back as the raw Postgres string.

- [x] **Step 3: Normalise in the parser**

In `apps/docs/lib/analytics-metrics.ts`, add above `parseDocsAnalyticsMetrics`:

```ts
/**
 * `updatedAt` arrives as Postgres text (`2026-09-11 00:27:00.82757+00`), not
 * ISO 8601. Engines are not required to parse that form, so it is normalised
 * here — the boundary every consumer passes through — and never handed to a
 * browser as-is. An unparseable value is returned untouched: `toISOString`
 * throws `RangeError`, and one bad timestamp must not empty the panel.
 */
function toIsoTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
```

and change the returned field (line 105) from `updatedAt: record.updatedAt,` to:

```ts
    updatedAt: toIsoTimestamp(record.updatedAt),
```

- [x] **Step 4: Verify**

Run: `cd apps/docs && bun run test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/docs/lib/analytics-metrics.ts apps/docs/test/analytics-metrics.test.ts
git commit -m "fix(docs): normalise the analytics timestamp at the parse boundary"
```

---

## Task 6: Viewer-local time and the boundary caption

**Files:**

- Create: `apps/docs/components/analytics/local-time.tsx`
- Modify: `apps/docs/components/analytics/usage-panel.tsx:276-281`
- Modify: `apps/docs/test/usage-panel.test.tsx`

- [x] **Step 1: Write the failing test in `apps/docs/test/usage-panel.test.tsx`**

The file already renders with `renderToStaticMarkup` over a `sample` fixture
and a `series` fixture. Reuse both:

```tsx
describe("day boundary and update time", () => {
  test("the server render keeps the UTC text as the no-JavaScript fallback", () => {
    // renderToStaticMarkup never runs effects, so this is exactly what a
    // viewer without JavaScript sees.
    const frame = renderToStaticMarkup(<UsagePanel metrics={sample} series={series} />);
    expect(frame).toContain("2026-08-14 00:05:00 UTC");
    expect(frame).toContain(`datetime="${sample.updatedAt}"`);
  });

  test("the day boundary is stated on the page", () => {
    // Nothing else pins this sentence; the payload-drift gate does not cover it.
    const frame = renderToStaticMarkup(<UsagePanel metrics={sample} series={series} />);
    expect(frame).toContain("midnight IST");
    expect(frame).toContain("15 September 2026");
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `cd apps/docs && bun run test`
Expected: FAIL on the caption assertion.

- [x] **Step 3: Write the client component**

```tsx
// apps/docs/components/analytics/local-time.tsx
"use client";

import { useEffect, useState } from "react";

/**
 * Renders a UTC timestamp on the server and upgrades it to the viewer's own
 * clock after mount.
 *
 * The swap happens in an effect rather than during render, so the server HTML
 * and the first client render are identical and hydration does not mismatch.
 * Without JavaScript the UTC text simply stays. `iso` is already strict ISO —
 * `parseDocsAnalyticsMetrics` normalises it — so no engine is asked to parse
 * the Postgres form.
 */
export function LocalTime({ iso, utcLabel }: { readonly iso: string; readonly utcLabel: string }) {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return;
    setLocal(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        parsed,
      ),
    );
  }, [iso]);

  return <time dateTime={iso}>{local ?? utcLabel}</time>;
}
```

- [x] **Step 4: Use it, and add the caption**

In `apps/docs/components/analytics/usage-panel.tsx`, import the component:

```tsx
import { LocalTime } from "./local-time";
```

Replace the `updated …` line:

```tsx
              updated <LocalTime iso={metrics.updatedAt} utcLabel={formatUpdatedAt(metrics.updatedAt)} />
```

and add the caption directly below that `<p>`:

```tsx
<p className="text-muted-foreground m-0 text-xs">
  Days end at midnight IST (18:30 UTC) from 15 September 2026; earlier days end at midnight UTC.
</p>
```

The caption sits once on `/analytics` and covers every day label on the page —
the snapshot day, the section cards, and the trend chart, table and span.

- [x] **Step 5: Verify**

```bash
cd apps/docs && bun run test
```

Expected: PASS, 0 lint problems, typecheck exits 0.

- [x] **Step 6: Commit**

```bash
git add apps/docs/components/analytics/local-time.tsx apps/docs/components/analytics/usage-panel.tsx apps/docs/test/usage-panel.test.tsx
git commit -m "feat(docs): show the analytics update time in the viewer's clock"
```

---

## Task 7: The contract and the user doc

Both change together, as the contract's own last line requires.

**Files:**

- Modify: `.docs/analytics-privacy-contract.md`
- Modify: `docs/users/reliability-and-privacy.mdx`

- [x] **Step 1: Amend the contract**

Under _Public metrics and operations_, after the `computed_at` paragraph, state:
the boundary is midnight IST (18:30 UTC) from `2026-09-14T18:30:00.000Z`;
`2026-09-14` is a single 18.5-hour seam day whose active count reads low and is
correct; earlier days remain UTC and are not rebuilt, because the
`(day, install_hash)` key kept only the first ping of each UTC day and the
crossing pings were never stored; retention cutoffs are computed from the same
labels they compare against, so a row may be held at most one extra day around
the seam — the safe direction, storage only.

- [x] **Step 2: Amend the user doc**

In `docs/users/reliability-and-privacy.mdx`, state in user language: days end at
midnight IST from 15 September 2026 and earlier days end at midnight UTC; the
"updated" time is shown in your own clock; day totals are not re-cut to your
local midnight, because only daily totals are kept.

- [x] **Step 3: Verify the pinned phrases survive**

```bash
bun run --cwd apps/cli test:file -- test/unit/architecture/analytics-payload-drift.test.ts
bun run verify:doc-paths
bun run verify:doc-frontmatter
```

Expected: PASS. That drift test pins the consent, small-cell and
`install_lifetime` wording in both documents — if it fails, wording it protects
was removed; restore it rather than editing the test.

- [x] **Step 4: Full gate and commit**

```bash
bun run typecheck --force && bun run lint --force && bun run test -- --force
git add .docs/analytics-privacy-contract.md docs/users/reliability-and-privacy.mdx
git commit -m "docs(analytics): state the IST day boundary and the seam day"
```

Expected: all three gates green, 0 failures.

---

## Task 8: The schedule — a separate PR, merged after the cutover

Do **not** include this in the branch above. Merging it early makes every day
between merge and cutover publish about 19 hours staler, because a 19:00 UTC run
can only roll up UTC-yesterday while the labels are still UTC.

**Files:**

- Modify: `apps/analytics-ingest/vercel.json:15`

- [ ] **Step 1: Prove the IST clock is live in production**

The published `day` cannot prove it. On the `5 0 * * *` schedule the old UTC
clock and the new IST clock publish the same day on every run, so a check like
"`day` is on or after the cutover" passes under both. Both of these are
required:

1. **The deployed commit.** In the Vercel dashboard for the analytics-ingest
   project, or with `vercel inspect` on its production URL, confirm the current
   production deployment's commit contains
   `apps/analytics-ingest/src/analytics-day.ts`. GitHub's deployment records
   cover the docs site only and cannot answer this.
2. **The clock's own answer, read between 18:30 and 24:00 UTC** on any day from
   the cutover on:

   ```bash
   curl -s -H "Authorization: Bearer $ANALYTICS_ADMIN_TOKEN" \
     https://analytics.kunai.kitsunekode.in/api/metrics/admin | jq -r .to
   ```

   `to` is the day the read side resolves at that moment. It must equal
   **today's UTC date**; the old clock returns the day before. Read before
   18:30 UTC the two clocks agree, so that read proves nothing.

If either check fails, stop.

- [ ] **Step 2: Change the schedule**

```json
{
  "path": "/api/cron/snapshot",
  "schedule": "0 19 * * *"
}
```

Hour 19, not 18: IST closes at 18:30 UTC and Hobby may fire anywhere inside the
scheduled hour, so an hour-18 job would run before the day closed about half the
time.

- [ ] **Step 3: Commit and open the PR**

```bash
git add apps/analytics-ingest/vercel.json
git commit -m "chore(analytics): publish the IST day at 00:30 IST"
```

- [ ] **Step 4: Verify after deploy**

The first run lands between 00:30 and 01:29 IST on Hobby, or at 00:30 IST on
Pro. Confirm `updatedAt` moves to a 19:xx UTC time and `day` is the day that
closed that evening.
