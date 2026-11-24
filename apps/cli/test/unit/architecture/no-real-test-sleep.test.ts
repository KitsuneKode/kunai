import { expect, test } from "bun:test";

import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

/**
 * A test that needs a wall-clock sleep to pass is wrong: it flakes under load
 * and hides a missing clock seam. New `Bun.sleep`, `setTimeout`, and
 * `setInterval` calls in tests fail here unless the line above them is
 * `sleep-allow:` with a reason. That comment is only for a real process, an
 * OS wait, or a delay the code under test does not let the test inject.
 * `setImmediate` and an injected fake timer are the replacements.
 */

const WAIT_CALL = /\bBun\.sleep\s*\(|\bsetInterval\s*\(|(?<![.\w])setTimeout\s*\(/;
const FAKE_TIMER_DEFINITION = /setTimeout\s*\(\s*callback\b/;
/** A zero delay is a turn boundary, not a wall-clock sleep. */
const ZERO_DELAY = /(?:Bun\.sleep|setTimeout)\s*\([^;\n]*,\s*0\s*\)|Bun\.sleep\s*\(\s*0\s*\)/;

function testFiles(): string[] {
  return [
    ...collectSourceFiles("apps", { extensions: [".ts", ".tsx"] }),
    ...collectSourceFiles("packages", { extensions: [".ts", ".tsx"] }),
  ].filter((file) => /\.(?:test|spec)\.tsx?$/.test(file));
}

function offendingWaits(source: string): string[] {
  const lines = source.split("\n");
  const offenders: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (!WAIT_CALL.test(line) || FAKE_TIMER_DEFINITION.test(line) || ZERO_DELAY.test(line)) {
      continue;
    }
    let previous = "";
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = (lines[cursor] ?? "").trim();
      if (candidate.length === 0) continue;
      previous = candidate;
      break;
    }
    if (previous.startsWith("// sleep-allow:") && previous.slice("// sleep-allow:".length).trim()) {
      continue;
    }
    offenders.push(`${index + 1}: ${trimmed}`);
  }
  return offenders;
}

test("test files do not gain a real sleep without a recorded reason", () => {
  const offenders: string[] = [];
  for (const file of testFiles()) {
    for (const hit of offendingWaits(readRepoFile(file))) {
      offenders.push(`${file}:${hit}`);
    }
  }
  expect(offenders).toEqual([]);
});
