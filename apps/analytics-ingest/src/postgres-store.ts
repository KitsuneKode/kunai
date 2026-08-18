import { neon } from "@neondatabase/serverless";

import { DEFAULT_ANALYTICS_LIMITS, type AnalyticsLimits } from "./limits.js";
import type {
  AnalyticsStore,
  DailyRollup,
  PruneLifetimeResult,
  RecordPingInput,
  RecordPingResult,
} from "./store.js";

/**
 * One statement, three effects: charge the day's admission budget, record the
 * ping, record the install.
 *
 * The budget upsert returns the post-increment count, and both inserts select
 * from it, which forces the ordering a bare list of data-modifying CTEs would
 * not guarantee and makes "over budget" mean "insert zero rows" rather than a
 * second round trip. Each table keeps its own conflict target, so idempotency
 * is unchanged.
 *
 * `last_seen` is refreshed only when it moves forward, so a repeat ping on a
 * day already recorded stays a genuine no-op instead of rewriting the row.
 */
export const RECORD_PING_SQL = `with budget as (
  insert into ingest_budget (day, attempts) values ($1::date, 1)
  on conflict (day) do update set attempts = ingest_budget.attempts + 1
  returning attempts
), admitted as (
  select 1 as ok from budget where attempts <= $6::bigint
), ping_day_insert as (
  insert into ping_day (day, install_hash, version, os, arch)
  select $1::date, decode($2, 'hex'), $3::text, $4::text, $5::text from admitted
  on conflict (day, install_hash) do nothing
), install_lifetime_insert as (
  insert into install_lifetime (install_hash, first_seen, last_seen)
  select decode($2, 'hex'), $1::date, $1::date from admitted
  on conflict (install_hash) do update set last_seen = excluded.last_seen
  where install_lifetime.last_seen < excluded.last_seen
)
select (select count(*)::int from admitted) as admitted`;

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
 * seen after the day being rolled up. Cron rolls up yesterday just after
 * midnight UTC, so today's installs were already inflating yesterday's number,
 * and recomputing an old day produced a different answer every time.
 *
 * `first_seen <= day` makes the figure a function of the day it labels, and one
 * statement makes every component share a snapshot.
 */
export const ROLL_UP_DAY_SQL = `with active as (
  select count(*)::int as n from ping_day where day = $1::date
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
    (day, active_installs, by_version, by_os, by_arch, lifetime_installs, computed_at)
  select $1::date,
         (select n from active),
         (select j from by_version),
         (select j from by_os),
         (select j from by_arch),
         (select n from lifetime),
         now()
  on conflict (day) do update set
    active_installs = excluded.active_installs,
    by_version = excluded.by_version,
    by_os = excluded.by_os,
    by_arch = excluded.by_arch,
    lifetime_installs = excluded.lifetime_installs,
    computed_at = now()
  returning day::text as day,
            active_installs,
            by_version,
            by_os,
            by_arch,
            lifetime_installs,
            computed_at::text as computed_at
)
select * from persisted`;

const ROLLUP_COLUMNS = `day::text as day, active_installs, by_version, by_os, by_arch,
  lifetime_installs, computed_at::text as computed_at`;

function toRollup(row: Record<string, unknown>): DailyRollup {
  return {
    day: String(row.day),
    computedAt: String(row.computed_at),
    activeInstalls: Number(row.active_installs),
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
      ])) as { admitted: number }[];
      return { admitted: Number(rows[0]?.admitted ?? 0) > 0 };
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
      const rows = (await sql.query(
        `with deleted as (delete from ping_day where day < $1::date returning 1)
         select count(*)::int as n from deleted`,
        [day],
      )) as { n: number }[];
      return Number(rows[0]?.n ?? 0);
    },

    async pruneLifetimeBefore(day: string): Promise<PruneLifetimeResult> {
      const rows = (await sql.query(PRUNE_LIFETIME_SQL, [day])) as { n: number }[];
      return { retired: Number(rows[0]?.n ?? 0) };
    },
  };
}
