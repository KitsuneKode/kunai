/**
 * Ingest, the cron and the read endpoints must agree on what day it is. When
 * they answered separately, a disagreement meant the cron rolled up a day that
 * held no rows. `analytics-day.ts` is the only place allowed to turn an instant
 * or a label into a `YYYY-MM-DD` label.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = "analytics-day.ts";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("day labels have one source", () => {
  test("no file but analytics-day.ts derives a day label", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];

    for (const directory of ["src", "api"]) {
      for (const file of sourceFiles(join(root, directory))) {
        if (file.endsWith(ALLOWED)) continue;
        // Whitespace-normalised on purpose: admin.ts once split this chain
        // across three lines, which a literal match would have missed.
        const body = readFileSync(file, "utf8").replaceAll(/\s+/g, "");
        if (body.includes("toISOString().slice(0,10)")) {
          offenders.push(file.slice(root.length + 1));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
