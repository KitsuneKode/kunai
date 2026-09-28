import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard: `runProviderCycle` candidate timeouts must go through
 * `providerCycleCandidateTimeoutMs(startupPriority, preferred)` so the value is
 * clamped to 80% of the attempt budget. A raw constant has shipped broken three
 * times — it silently never fires when it exceeds the caller's attempt budget
 * (10s under a 6s `fast` budget, 15s under 6s/12s budgets).
 */

const SRC_DIR = new URL("../src", import.meta.url).pathname;

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* tsFiles(path);
    } else if (entry.endsWith(".ts")) {
      yield path;
    }
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const RAW_TIMEOUT_PATTERN = /candidateTimeoutMs:\s*\d[\d_]*/;

describe("provider cycle candidate timeouts respect the attempt budget", () => {
  const offenders: string[] = [];

  for (const file of tsFiles(SRC_DIR)) {
    if (RAW_TIMEOUT_PATTERN.test(stripComments(readFileSync(file, "utf8")))) {
      offenders.push(file.replace(`${SRC_DIR}/`, ""));
    }
  }

  test("no runProviderCycle call passes a raw candidateTimeoutMs literal", () => {
    expect(offenders).toEqual([]);
  });
});
