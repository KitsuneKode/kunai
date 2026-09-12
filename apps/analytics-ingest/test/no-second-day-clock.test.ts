/**
 * Ingest, the cron and the read endpoints must agree on what day it is. When
 * they answered separately, a disagreement meant the cron rolled up a day that
 * held no rows. `analytics-day.ts` is the only place allowed to turn an instant
 * or a label into a `YYYY-MM-DD` label.
 *
 * The guard names every common way to derive a calendar day from a `Date`
 * rather than one of them — the first version matched only
 * `toISOString().slice(0, 10)`, so `.split("T")[0]` or `getUTCDate()` would have
 * passed. It is still a list, not a proof: a date library, or a regex run over
 * an ISO string, would get past it. Route that through `analytics-day.ts`
 * instead of teaching this file an exception.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = "analytics-day.ts";

/**
 * Each form, matched against source with all whitespace removed — admin.ts once
 * split `.toISOString().slice(0, 10)` across three lines, which a literal match
 * missed.
 */
const DAY_LABEL_FORMS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ["cutting an ISO string", /toISOString\(\)\.(?:slice|substring|substr|split)\(/],
  ["reading calendar fields", /\.get(?:UTC)?(?:FullYear|Month|Date|Day)\(/],
  ["setting calendar fields", /\.set(?:UTC)?(?:FullYear|Month|Date)\(/],
  ["locale date formatting", /toLocaleDateString\(|toDateString\(|Intl\.DateTimeFormat/],
];

/** The first form `source` uses to derive a day label, or null. */
function dayLabelForm(source: string): string | null {
  const compact = source.replaceAll(/\s+/g, "");
  for (const [name, pattern] of DAY_LABEL_FORMS) {
    if (pattern.test(compact)) return name;
  }
  return null;
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("the matcher recognises each form", () => {
  // A guard nobody has seen fail proves nothing, so every form it claims to
  // catch is exercised here, alongside what must stay allowed.
  test.each([
    ["new Date(now).toISOString().slice(0, 10)"],
    ["new Date(now)\n  .toISOString()\n  .slice(0, 10)"],
    ["date.toISOString().substring(0, 10)"],
    ['date.toISOString().split("T")[0]'],
    ["date.getUTCFullYear()"],
    ["date.getDate()"],
    ["end.setUTCDate(end.getUTCDate() - 1)"],
    ['date.toLocaleDateString("en-CA")'],
    ['new Intl.DateTimeFormat("en-CA").format(date)'],
  ])("flags %j", (source) => {
    expect(dayLabelForm(source)).not.toBeNull();
  });

  test.each([
    ["new Date().toISOString()"],
    ["Date.now()"],
    ["date.getTime()"],
    ["Date.parse(value)"],
    ["analyticsDayKey(now)"],
    ["shiftDayKey(day, -1)"],
  ])("allows %j", (source) => {
    expect(dayLabelForm(source)).toBeNull();
  });
});

describe("day labels have one source", () => {
  test("no file but analytics-day.ts derives a day label", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];

    for (const directory of ["src", "api"]) {
      for (const file of sourceFiles(join(root, directory))) {
        if (file.endsWith(ALLOWED)) continue;
        const form = dayLabelForm(readFileSync(file, "utf8"));
        if (form) offenders.push(`${file.slice(root.length + 1)} (${form})`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
