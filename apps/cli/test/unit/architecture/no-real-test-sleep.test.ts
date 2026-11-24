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

const WAIT_CALL =
  /\bBun\.sleep(?:Sync)?\s*\(|\bsetInterval\s*\(|(?:\bglobalThis\.|(?<![.\w]))setTimeout\s*\(/g;
/** `setTimeout(callback: …)` or `setTimeout(callback, ms) {` declares a fake timer; it does not wait. */
const FAKE_TIMER_DEFINITION =
  /setTimeout\s*\(\s*\w+\s*:|setTimeout\s*\([^()]*\)\s*(?::[^{]*)?\{\s*$/;
const TIMERS_PROMISES_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?timers\/promises["']/g;
const HELPER_DEFINITION = /(?:function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=)/;
const ALLOW = "// sleep-allow:";

function testFiles(): string[] {
  return [
    ...collectSourceFiles("apps", { extensions: [".ts", ".tsx"] }),
    ...collectSourceFiles("packages", { extensions: [".ts", ".tsx"] }),
  ].filter((file) => /\.(?:test|spec)\.tsx?$/.test(file));
}

/** The call's top-level arguments, read up to its own closing paren on this line. */
function callArguments(line: string, openParen: number): string[] | null {
  let depth = 0;
  let current = "";
  const args: string[] = [];
  for (let index = openParen; index < line.length; index += 1) {
    const char = line[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
    } else if (char === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  return null;
}

/** A zero delay is a turn boundary, not a wall-clock sleep. */
function isZeroDelay(line: string, openParen: number, callee: string): boolean {
  const args = callArguments(line, openParen);
  if (!args) return false;
  const delay = callee.startsWith("Bun.sleep") ? args[0] : args[1];
  return delay === "0" || (callee.includes("setTimeout") && args.length === 1);
}

function allowedAbove(lines: readonly string[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = (lines[cursor] ?? "").trim();
    if (candidate.length === 0) continue;
    return candidate.startsWith(ALLOW) && candidate.slice(ALLOW.length).trim().length > 0;
  }
  return false;
}

function isComment(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** The next few lines, for a call whose arguments span lines. */
function following(lines: readonly string[], index: number): string {
  return lines.slice(index + 1, index + 12).join("\n");
}

/** True when the line makes a wall-clock wait that is not a zero-delay turn boundary. */
function lineWaits(line: string, continuation = ""): boolean {
  // The call may close on a later line; read its arguments across them.
  const text = continuation ? `${line}\n${continuation}` : line;
  for (const match of line.matchAll(WAIT_CALL)) {
    const callee = match[0].replace(/\s*\($/, "");
    const openParen = (match.index ?? 0) + match[0].length - 1;
    if (!isZeroDelay(text, openParen, callee)) return true;
  }
  return false;
}

/** Names that wait on the wall clock: `timers/promises` imports and local helpers wrapping a sleep. */
function sleepHelperNames(lines: readonly string[]): Map<string, number> {
  const helpers = new Map<string, number>();
  const source = lines.join("\n");
  for (const match of source.matchAll(TIMERS_PROMISES_IMPORT)) {
    for (const part of (match[1] ?? "").split(",")) {
      const local = part
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (local) helpers.set(local, -1);
    }
  }
  lines.forEach((line, index) => {
    if (FAKE_TIMER_DEFINITION.test(line) || !lineWaits(line, following(lines, index))) return;
    for (let cursor = index; cursor >= Math.max(0, index - 3); cursor -= 1) {
      const definition = HELPER_DEFINITION.exec(lines[cursor] ?? "");
      const name = definition?.[1] ?? definition?.[2];
      if (name) {
        helpers.set(name, cursor);
        return;
      }
    }
  });
  return helpers;
}

export function offendingWaits(source: string): string[] {
  const lines = source.split("\n");
  const helpers = sleepHelperNames(lines);
  const offenders: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (isComment(trimmed) || /^import\b/.test(trimmed)) continue;
    let waits = !FAKE_TIMER_DEFINITION.test(line) && lineWaits(line, following(lines, index));
    for (const [name, definedAt] of helpers) {
      if (definedAt === index) continue;
      const call = new RegExp(`(?<![.\\w])${name}\\s*\\(`);
      const found = call.exec(line);
      // `function sleep(` / `const sleep =` define the helper; `const x = await sleep(` calls it.
      const defines = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=)`);
      if (found && !defines.test(line)) {
        if (!isZeroDelay(line, found.index + found[0].length - 1, "Bun.sleep")) waits = true;
      }
    }
    if (waits && !allowedAbove(lines, index)) offenders.push(`${index + 1}: ${trimmed}`);
  }
  return offenders;
}

test("test files do not gain a real sleep without a recorded reason", () => {
  const offenders: string[] = [];
  for (const file of testFiles()) {
    // This file holds sleep shapes as string fixtures for the checks below.
    if (file.endsWith("no-real-test-sleep.test.ts")) continue;
    for (const hit of offendingWaits(readRepoFile(file))) {
      offenders.push(`${file}:${hit}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the ratchet catches every common way to sleep", () => {
  const caught = (source: string) => offendingWaits(source).length;
  expect(caught("await Bun.sleep(50);")).toBe(1);
  expect(caught("Bun.sleepSync(50);")).toBe(1);
  expect(caught("await new Promise((r) => globalThis.setTimeout(r, 50));")).toBe(1);
  expect(caught("setTimeout(callback, 5_000);")).toBe(1);
  expect(caught("setTimeout(() => finish(result, 0), 5_000);")).toBe(1);
  // A helper call inside a variable initializer is still a call.
  expect(
    caught(
      'import { setTimeout as sleep } from "node:timers/promises";\nconst value = await sleep(1_000, "done");',
    ),
  ).toBe(1);
  expect(
    caught('import { setTimeout as sleep } from "node:timers/promises";\nawait sleep(50);'),
  ).toBe(1);
  // A reason on the helper does not waive its call sites.
  expect(
    caught(
      "// sleep-allow: helper\nconst sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\nawait sleep(5_000);",
    ),
  ).toBe(1);
});

test("turn boundaries and fake-timer declarations are not sleeps", () => {
  const caught = (source: string) => offendingWaits(source).length;
  expect(caught("await Bun.sleep(0);")).toBe(0);
  expect(caught("setTimeout(resolve, 0);")).toBe(0);
  expect(caught("setTimeout(() => done(), 0);")).toBe(0);
  expect(caught("setTimeout(resolve);")).toBe(0);
  expect(caught("setTimeout(\n  () => {\n    done();\n  },\n  0,\n);")).toBe(0);
  expect(caught("setTimeout(\n  () => done(),\n  1_000,\n);")).toBe(1);
  expect(caught("  setTimeout(callback: () => void, delayMs: number): number;")).toBe(0);
  expect(caught("      setTimeout(callback, delayMs) {")).toBe(0);
  expect(caught("// sleep-allow: real child process\nawait Bun.sleep(50);")).toBe(0);
});
