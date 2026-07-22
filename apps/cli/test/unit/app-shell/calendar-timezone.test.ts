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
 */
const MODEL = join(import.meta.dirname, "../../../src/app-shell/calendar-ui.model.ts");

function weekKeyUnderTz(tz: string, isoDay: string): string {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `import { calendarWeekKeyFromIsoDay } from ${JSON.stringify(MODEL)};
       process.stdout.write(calendarWeekKeyFromIsoDay(${JSON.stringify(isoDay)}));`,
    ],
    env: { ...process.env, TZ: tz },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`TZ=${tz} run failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

const ZONES = ["UTC", "Asia/Kolkata", "America/New_York", "Pacific/Auckland"];

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
