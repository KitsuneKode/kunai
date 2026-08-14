import { neon } from "@neondatabase/serverless";

import type { AnalyticsStore, DailyRollup, RecordPingInput } from "./store";

type CountRow = { readonly bucket: string; readonly n: number };

function toCounts(rows: readonly CountRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.bucket] = Number(row.n);
  return counts;
}

function toRollup(row: Record<string, unknown>): DailyRollup {
  return {
    day: String(row.day),
    activeInstalls: Number(row.active_installs),
    byVersion: row.by_version as Record<string, number>,
    byOs: row.by_os as Record<string, number>,
    byArch: row.by_arch as Record<string, number>,
    lifetimeInstalls: Number(row.lifetime_installs),
  };
}

export function createPostgresAnalyticsStore(connectionString: string): AnalyticsStore {
  const sql = neon(connectionString);

  return {
    async recordPing(input: RecordPingInput): Promise<void> {
      const hash = Buffer.from(input.installHash, "hex");
      // Idempotent by primary key. This single statement is the once-per-day
      // gate — atomic, unlike the claim-then-record pair it replaces.
      await sql.query(
        `insert into ping_day (day, install_hash, version, os, arch)
         values ($1, $2, $3, $4, $5)
         on conflict (day, install_hash) do nothing`,
        [input.day, hash, input.version, input.os, input.arch],
      );
      await sql.query(
        `insert into install_lifetime (install_hash, first_seen)
         values ($1, $2)
         on conflict (install_hash) do nothing`,
        [hash, input.day],
      );
    },

    async rollUpDay(day: string): Promise<DailyRollup> {
      const active = (await sql.query(`select count(*)::int as n from ping_day where day = $1`, [
        day,
      ])) as { n: number }[];
      const lifetime = (await sql.query(`select count(*)::int as n from install_lifetime`)) as {
        n: number;
      }[];

      // Column name is interpolated from a closed literal union, never input.
      const grouped = async (column: "version" | "os" | "arch") =>
        toCounts(
          (await sql.query(
            `select ${column} as bucket, count(*)::int as n
             from ping_day where day = $1 group by ${column}`,
            [day],
          )) as CountRow[],
        );

      const rollup: DailyRollup = {
        day,
        activeInstalls: Number(active[0]?.n ?? 0),
        byVersion: await grouped("version"),
        byOs: await grouped("os"),
        byArch: await grouped("arch"),
        lifetimeInstalls: Number(lifetime[0]?.n ?? 0),
      };

      await sql.query(
        `insert into daily_rollup
           (day, active_installs, by_version, by_os, by_arch, lifetime_installs, computed_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (day) do update set
           active_installs = excluded.active_installs,
           by_version = excluded.by_version,
           by_os = excluded.by_os,
           by_arch = excluded.by_arch,
           lifetime_installs = excluded.lifetime_installs,
           computed_at = now()`,
        [
          rollup.day,
          rollup.activeInstalls,
          JSON.stringify(rollup.byVersion),
          JSON.stringify(rollup.byOs),
          JSON.stringify(rollup.byArch),
          rollup.lifetimeInstalls,
        ],
      );

      return rollup;
    },

    async readRollup(day: string): Promise<DailyRollup | null> {
      const rows = (await sql.query(
        `select day::text, active_installs, by_version, by_os, by_arch, lifetime_installs
         from daily_rollup where day = $1`,
        [day],
      )) as Record<string, unknown>[];
      const row = rows[0];
      return row ? toRollup(row) : null;
    },

    async readRollups(fromDay: string, toDay: string): Promise<readonly DailyRollup[]> {
      const rows = (await sql.query(
        `select day::text, active_installs, by_version, by_os, by_arch, lifetime_installs
         from daily_rollup where day >= $1 and day <= $2 order by day asc`,
        [fromDay, toDay],
      )) as Record<string, unknown>[];
      return rows.map(toRollup);
    },

    async pruneRawBefore(day: string): Promise<number> {
      const rows = (await sql.query(
        `with deleted as (delete from ping_day where day < $1 returning 1)
         select count(*)::int as n from deleted`,
        [day],
      )) as { n: number }[];
      return Number(rows[0]?.n ?? 0);
    },
  };
}
