import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Week bucketing must agree with the LOCAL day, because every row's dayKey is
 * built from local getFullYear/getMonth/getDate. Mixing in a UTC date shifts the
 * week for anyone east or west of UTC — in IST (+05:30) the current week loses
 * its band before 05:30, and "Week of …" headers name the Sunday.
 *
 * Each timezone runs in its own subprocess. Setting `process.env.TZ` in-process
 * is not hermetic — the runtime caches the zone for `Date`, so restoring the var
 * does not reliably undo it and unrelated date-sensitive suites start failing.
 *
 * It lives in `test/integration` because that is what it is: spawning four Bun
 * processes is not a unit test, and `test:unit` runs `--parallel`, where those
 * blocking spawns compete with the whole suite for the same cores and reliably
 * cross the 20s budget. `test:integration` runs serially, so the same work
 * finishes in a fraction of a second.
 */
const MODEL = join(import.meta.dirname, "../../src/app-shell/calendar-ui.model.ts");

const ZONES = ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Auckland"];
const DAYS = ["2026-07-22", "2026-07-20", "2026-07-26"] as const;

/**
 * One subprocess per zone, not one per assertion.
 *
 * `TZ` is read once per process, so each zone genuinely needs its own -- but
 * every day under that zone can be answered by the same run. Spawning per
 * assertion meant 12 Bun startups to make 12 comparisons, and Bun startup, not
 * the comparison, is the whole cost: 280ms locally and past the 20s per-test
 * budget under parallel CI load, where the suite competes for the same cores.
 * Batching makes it 4 startups, computed once and reused by all three tests.
 */
const weekKeysByZone = new Map<string, Record<string, string>>();

function weekKeysUnderTz(tz: string): Record<string, string> {
  const cached = weekKeysByZone.get(tz);
  if (cached) return cached;

  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `import { calendarWeekKeyFromIsoDay } from ${JSON.stringify(MODEL)};
       const days = ${JSON.stringify(DAYS)};
       const out = {};
       for (const day of days) out[day] = calendarWeekKeyFromIsoDay(day);
       process.stdout.write(JSON.stringify(out));`,
    ],
    env: { ...process.env, TZ: tz },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`TZ=${tz} run failed: ${result.stderr.toString()}`);
  }
  const parsed = JSON.parse(result.stdout.toString().trim()) as Record<string, string>;
  weekKeysByZone.set(tz, parsed);
  return parsed;
}

function weekKeyUnderTz(tz: string, isoDay: string): string {
  const key = weekKeysUnderTz(tz)[isoDay];
  if (key === undefined) throw new Error(`${isoDay} is not in DAYS; add it there so it is batched`);
  return key;
}

test("week key is the local Monday in every timezone", () => {
  // 2026-07-22 is a Wednesday; its week starts Monday 2026-07-20.
  for (const tz of ZONES) {
    expect(weekKeyUnderTz(tz, "2026-07-22"), `TZ=${tz}`).toBe("2026-07-20");
  }
});

test("a Monday is its own week key, not the Sunday before it", () => {
  // The off-by-one that produced "Week of Jul 19" for a week starting Jul 20.
  for (const tz of ZONES) {
    expect(weekKeyUnderTz(tz, "2026-07-20"), `TZ=${tz}`).toBe("2026-07-20");
  }
});

test("a Sunday belongs to the week that started the previous Monday", () => {
  for (const tz of ZONES) {
    expect(weekKeyUnderTz(tz, "2026-07-26"), `TZ=${tz}`).toBe("2026-07-20");
  }
});
