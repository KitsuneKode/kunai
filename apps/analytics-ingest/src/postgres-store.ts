import { neon } from "@neondatabase/serverless";

import { DEFAULT_ANALYTICS_LIMITS, type AnalyticsLimits } from "./limits.js";
import type {
  AnalyticsStore,
  CohortRollup,
  DailyRollup,
  DistributionEntry,
  DistributionRow,
  DistributionSource,
  MonthRollup,
  PruneLifetimeResult,
  RecordPingInput,
  RecordPingResult,
} from "./store.js";

/** `YYYY-MM` → the `date` a month column stores. */
function monthDate(month: string): string {
  return `${month}-01`;
}

/**
 * One statement: decide, then charge the budget and record the ping.
 *
 * Two reads come first, and nothing below them writes unless both pass:
 *
 * - `seen`: this install already has today's row. A repeat ping is a no-op, so
 *   it spends no budget — admission counts distinct installs, not requests,
 *   and a retrying client cannot crowd anyone else out.
 * - `gate`: the day's budget still has room. Once the ceiling is reached the
 *   counter is no longer touched, so an over-budget request writes nothing at
 *   all — not even the budget row every other request would contend on.
 *
 * The budget upsert re-checks the ceiling in its `where`, so two requests
 * racing past `gate` at the last slot cannot overshoot it. Two racing copies
 * of the same new ping can each spend one slot; only one row results. Every
 * insert selects from `admitted`, which forces the ordering a bare list of
 * data-modifying CTEs would not guarantee.
 *
 * `install_lifetime` is v1 only ($9). `last_seen` is refreshed only when it
 * moves forward. `month_active` keeps one row per install per month ($7), with
 * the v2 cohort ($8, null for v1).
 */
export const RECORD_PING_SQL = `with seen as (
  select exists (
    select 1 from ping_day where day = $1::date and install_hash = decode($2, 'hex')
  ) as duplicate
), gate as (
  select 1 as open from seen
  where not seen.duplicate
    and coalesce((select attempts from ingest_budget where day = $1::date), 0) < $6::bigint
), budget as (
  insert into ingest_budget (day, attempts) select $1::date, 1 from gate
  on conflict (day) do update set attempts = ingest_budget.attempts + 1
  where ingest_budget.attempts < $6::bigint
  returning attempts
), admitted as (
  select 1 as ok from budget
), ping_day_insert as (
  insert into ping_day (day, install_hash, version, os, arch)
  select $1::date, decode($2, 'hex'), $3::text, $4::text, $5::text from admitted
  on conflict (day, install_hash) do nothing
), install_lifetime_insert as (
  insert into install_lifetime (install_hash, first_seen, last_seen)
  select decode($2, 'hex'), $1::date, $1::date from admitted where $9::boolean
  on conflict (install_hash) do update set last_seen = excluded.last_seen
  where install_lifetime.last_seen < excluded.last_seen
), month_active_insert as (
  insert into month_active (month, install_hash, cohort)
  select $7::date, decode($2, 'hex'), $8::date from admitted
  on conflict (month, install_hash) do nothing
)
select (select count(*)::int from admitted) as admitted,
       (select duplicate from seen) as duplicate`;

/**
 * Every month still holding `month_active` rows, recomputed in one statement.
 *
 * Months whose rows are already pruned are not touched, so their rollups are
 * final. `month_active` holds at most two months at a time, so this is bounded.
 */
export const ROLL_UP_MONTHS_SQL = `with monthly as (
  insert into month_rollup (month, active_installs, computed_at)
  select month, count(*)::int, now() from month_active group by month
  on conflict (month) do update set
    active_installs = excluded.active_installs,
    computed_at = excluded.computed_at
  returning month
), cohorts as (
  insert into cohort_rollup (cohort, month, installs, computed_at)
  select cohort, month, count(*)::int, now() from month_active
  where cohort is not null group by cohort, month
  on conflict (cohort, month) do update set
    installs = excluded.installs,
    computed_at = excluded.computed_at
  returning 1
)
select to_char(month, 'YYYY-MM') as month, (select count(*)::int from cohorts) as cohort_rows
from monthly order by month`;

/**
 * Replace one day's distribution snapshot in a single statement: upsert every
 * entry, and delete that day's rows the new snapshot no longer lists. The two
 * touch disjoint keys, so their order inside the statement does not matter.
 */
export const WRITE_DISTRIBUTION_SQL = `with entries as (
  select e.source, e.release, e.platform, e.cumulative
  from jsonb_to_recordset($2::jsonb) as e(source text, release text, platform text, cumulative bigint)
), upserted as (
  insert into distribution_daily (day, source, release, platform, cumulative)
  select $1::date, source, release, platform, cumulative from entries
  on conflict (day, source, release, platform) do update set cumulative = excluded.cumulative
  returning 1
), stale as (
  delete from distribution_daily d
  where d.day = $1::date
    and not exists (
      select 1 from entries e
      where e.source = d.source and e.release = d.release and e.platform = d.platform
    )
)
select count(*)::int as n from upserted`;

/**
 * Delete unseen installs and add them to the retired counter in one statement,
 * so a crash between the two can never silently lower the lifetime total.
 */
export const PRUNE_LIFETIME_SQL = `with deleted as (
  delete from install_lifetime where last_seen < $1::date returning 1
), counted as (
  select count(*)::int as n from deleted
), bumped as (
  update lifetime_retired set retired_installs = retired_installs + (select n from counted)
  where id = 1
)
select (select n from counted) as n`;

/**
 * Top-N buckets for one dimension, tail folded into `other`, as a single jsonb
 * value. Aggregation happens in the database, so a flood of invented versions
 * never crosses the wire or the function's memory.
 *
 * `column` is interpolated from a closed literal union, never from input.
 */
function bucketJsonCte(alias: string, column: "version" | "os" | "arch"): string {
  return `${alias} as (
    select coalesce(jsonb_object_agg(bucket, n) filter (where rn <= $2::int), '{}'::jsonb)
         || case
              when coalesce(sum(n) filter (where rn > $2::int), 0) > 0
              then jsonb_build_object('other', sum(n) filter (where rn > $2::int)::int)
              else '{}'::jsonb
            end as j
    from (
      select ${column} as bucket,
             count(*)::int as n,
             row_number() over (order by count(*) desc, ${column} asc) as rn
      from ping_day where day = $1::date group by ${column}
    ) ranked
  )`;
}

/**
 * The whole rollup as one statement.
 *
 * It used to be six sequential HTTP round trips, each its own transaction, and
 * both halves of that were wrong. `activeInstalls` and the `by_*` maps came
 * from different snapshots, so a ping landing mid-rollup published dimension
 * counts that did not add up to the active total. And the lifetime figure was
 * `count(*) from install_lifetime` — every install ever, *including ones first
 * seen after the day being rolled up. Cron rolls up yesterday just after the
 * day boundary, so today's installs were already inflating yesterday's number,
 * and recomputing an old day produced a different answer every time.
 *
 * `first_seen <= day` makes the live half a function of the day it labels, and
 * one statement makes every component share a snapshot. The retired half is a
 * single counter with no dates — as-of-now, not as-of-`day` — which cannot
 * skew a recompute because a prunable row was always last seen before every
 * day the raw window can still reach. What it does mean: an install that
 * returns after retirement writes a fresh `install_lifetime` row while still
 * counting inside `lifetime_retired` — cumulative observations, not a
 * unique-install total.
 */
export const ROLL_UP_DAY_SQL = `with active as (
  select count(*)::int as n from ping_day where day = $1::date
), fresh as (
  -- first_seen = day is exact here: such a row has last_seen >= day and can
  -- only ever be pruned once that day is past the retention window — by which
  -- point the raw window has long since stopped offering it for rollup.
  select count(*)::int as n from install_lifetime where first_seen = $1::date
), lifetime as (
  select (
    (select count(*) from install_lifetime where first_seen <= $1::date)
    + (select coalesce(max(retired_installs), 0) from lifetime_retired)
  )::int as n
), ${bucketJsonCte("by_version", "version")},
   ${bucketJsonCte("by_os", "os")},
   ${bucketJsonCte("by_arch", "arch")},
persisted as (
  insert into daily_rollup
    (day, active_installs, new_installs, by_version, by_os, by_arch, lifetime_installs, computed_at)
  select $1::date,
         (select n from active),
         (select n from fresh),
         (select j from by_version),
         (select j from by_os),
         (select j from by_arch),
         (select n from lifetime),
         now()
  on conflict (day) do update set
    active_installs = excluded.active_installs,
    new_installs = excluded.new_installs,
    by_version = excluded.by_version,
    by_os = excluded.by_os,
    by_arch = excluded.by_arch,
    lifetime_installs = excluded.lifetime_installs,
    computed_at = now()
  returning day::text as day,
            active_installs,
            new_installs,
            by_version,
            by_os,
            by_arch,
            lifetime_installs,
            computed_at::text as computed_at
)
select * from persisted`;

const ROLLUP_COLUMNS = `day::text as day, active_installs, new_installs, by_version, by_os, by_arch,
  lifetime_installs, computed_at::text as computed_at`;

function toRollup(row: Record<string, unknown>): DailyRollup {
  return {
    day: String(row.day),
    computedAt: String(row.computed_at),
    activeInstalls: Number(row.active_installs),
    newInstalls: Number(row.new_installs),
    byVersion: row.by_version as Record<string, number>,
    byOs: row.by_os as Record<string, number>,
    byArch: row.by_arch as Record<string, number>,
    lifetimeInstalls: Number(row.lifetime_installs),
  };
}

export function createPostgresAnalyticsStore(
  connectionString: string,
  limits: AnalyticsLimits = DEFAULT_ANALYTICS_LIMITS,
): AnalyticsStore {
  const sql = neon(connectionString);

  return {
    async recordPing(input: RecordPingInput): Promise<RecordPingResult> {
      const rows = (await sql.query(RECORD_PING_SQL, [
        input.day,
        input.installHash,
        input.version,
        input.os,
        input.arch,
        limits.maxPingsPerDay,
        monthDate(input.v2?.activeMonth ?? input.day.slice(0, 7)),
        input.v2 ? monthDate(input.v2.cohort) : null,
        !input.v2,
      ])) as { admitted: number; duplicate: boolean }[];
      const duplicate = rows[0]?.duplicate === true;
      // A duplicate is not a refusal: the install is already counted today.
      return { admitted: duplicate || Number(rows[0]?.admitted ?? 0) > 0, duplicate };
    },

    async rollUpDay(day: string): Promise<DailyRollup> {
      const rows = (await sql.query(ROLL_UP_DAY_SQL, [
        day,
        limits.maxBucketsPerDimension,
      ])) as Record<string, unknown>[];
      const row = rows[0];
      if (!row) throw new Error(`rollUpDay(${day}) persisted no row`);
      return toRollup(row);
    },

    async readRollup(day: string): Promise<DailyRollup | null> {
      const rows = (await sql.query(
        `select ${ROLLUP_COLUMNS} from daily_rollup where day = $1::date`,
        [day],
      )) as Record<string, unknown>[];
      const row = rows[0];
      return row ? toRollup(row) : null;
    },

    async readLatestRollupAtOrBefore(day: string): Promise<DailyRollup | null> {
      const rows = (await sql.query(
        `select ${ROLLUP_COLUMNS} from daily_rollup
         where day <= $1::date order by day desc limit 1`,
        [day],
      )) as Record<string, unknown>[];
      const row = rows[0];
      return row ? toRollup(row) : null;
    },

    async readRollups(fromDay: string, toDay: string): Promise<readonly DailyRollup[]> {
      const rows = (await sql.query(
        `select ${ROLLUP_COLUMNS} from daily_rollup
         where day >= $1::date and day <= $2::date order by day asc`,
        [fromDay, toDay],
      )) as Record<string, unknown>[];
      return rows.map(toRollup);
    },

    async findDaysNeedingRollup(fromDay: string, toDay: string): Promise<readonly string[]> {
      const rows = (await sql.query(
        `select distinct raw.day::text as day
         from ping_day raw
         left join daily_rollup rollup on rollup.day = raw.day
         where raw.day >= $1::date and raw.day <= $2::date and rollup.day is null
         order by day asc`,
        [fromDay, toDay],
      )) as { day: string }[];
      return rows.map((row) => String(row.day));
    },

    async pruneRawBefore(day: string): Promise<number> {
      // ingest_budget is day-keyed too — a past day's admission count means
      // nothing once the day is gone, so the table would otherwise grow one
      // row per day forever. The return counts ping_day rows only; the budget
      // sweep is housekeeping, not a signal worth reporting.
      const rows = (await sql.query(
        `with deleted as (delete from ping_day where day < $1::date returning 1),
              budget as (delete from ingest_budget where day < $1::date returning 1)
         select count(*)::int as n from deleted`,
        [day],
      )) as { n: number }[];
      return Number(rows[0]?.n ?? 0);
    },

    async pruneLifetimeBefore(day: string): Promise<PruneLifetimeResult> {
      const rows = (await sql.query(PRUNE_LIFETIME_SQL, [day])) as { n: number }[];
      return { retired: Number(rows[0]?.n ?? 0) };
    },

    async rollUpMonths(): Promise<readonly string[]> {
      // SAFETY: the statement's final select names exactly these columns.
      const rows = (await sql.query(ROLL_UP_MONTHS_SQL)) as { month: string }[];
      return rows.map((row) => String(row.month));
    },

    async pruneMonthActiveBefore(month: string): Promise<number> {
      // SAFETY: the statement's final select names exactly this column.
      const rows = (await sql.query(
        `with deleted as (delete from month_active where month < $1::date returning 1)
         select count(*)::int as n from deleted`,
        [monthDate(month)],
      )) as { n: number }[];
      return Number(rows[0]?.n ?? 0);
    },

    async readMonthRollups(fromMonth: string, toMonth: string): Promise<readonly MonthRollup[]> {
      // SAFETY: the select list names exactly these columns.
      const rows = (await sql.query(
        `select to_char(month, 'YYYY-MM') as month, active_installs, computed_at::text as computed_at
         from month_rollup where month >= $1::date and month <= $2::date order by month asc`,
        [monthDate(fromMonth), monthDate(toMonth)],
      )) as { month: string; active_installs: number; computed_at: string }[];
      return rows.map((row) => ({
        month: String(row.month),
        activeInstalls: Number(row.active_installs),
        computedAt: String(row.computed_at),
      }));
    },

    async readCohortRollups(fromCohort: string): Promise<readonly CohortRollup[]> {
      // SAFETY: the select list names exactly these columns.
      const rows = (await sql.query(
        `select to_char(cohort, 'YYYY-MM') as cohort, to_char(month, 'YYYY-MM') as month,
                installs, computed_at::text as computed_at
         from cohort_rollup where cohort >= $1::date order by cohort asc, month asc`,
        [monthDate(fromCohort)],
      )) as { cohort: string; month: string; installs: number; computed_at: string }[];
      return rows.map((row) => ({
        cohort: String(row.cohort),
        month: String(row.month),
        installs: Number(row.installs),
        computedAt: String(row.computed_at),
      }));
    },

    async writeDistributionSnapshot(
      day: string,
      entries: readonly DistributionEntry[],
    ): Promise<number> {
      // SAFETY: the statement's final select names exactly this column.
      const rows = (await sql.query(WRITE_DISTRIBUTION_SQL, [day, JSON.stringify(entries)])) as {
        n: number;
      }[];
      return Number(rows[0]?.n ?? 0);
    },

    async readDistribution(fromDay: string, toDay: string): Promise<readonly DistributionRow[]> {
      // SAFETY: the select list names exactly these columns, and `source` is
      // only ever written from the closed DistributionSource union.
      const rows = (await sql.query(
        `select day::text as day, source, release, platform, cumulative::text as cumulative
         from distribution_daily where day >= $1::date and day <= $2::date
         order by day asc, source asc, release asc, platform asc`,
        [fromDay, toDay],
      )) as {
        day: string;
        source: DistributionSource;
        release: string;
        platform: string;
        cumulative: string;
      }[];
      return rows.map((row) => ({
        day: String(row.day),
        source: row.source,
        release: String(row.release),
        platform: String(row.platform),
        cumulative: Number(row.cumulative),
      }));
    },
  };
}
