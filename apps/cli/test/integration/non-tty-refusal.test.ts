/**
 * Running without a TTY must fail like a CLI, not like a crash.
 *
 * The Ink shell needs raw mode on stdin. Without it, mounting used to throw
 * inside the React reconciler and print a stack trace naming ink internals —
 * which reads as a broken build to anyone who piped the output, redirected it,
 * or guessed a subcommand that does not exist.
 *
 * Driven as a subprocess with stdin set to a pipe, because that is the only
 * way to reproduce the missing TTY faithfully.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts");

async function runWithoutTty(args: readonly string[]) {
  const proc = Bun.spawn(["bun", MAIN, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KUNAI_ANALYTICS_URL: "" },
  });
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("non-TTY invocation", () => {
  test("refuses with an actionable message instead of a stack trace", async () => {
    const { stderr, exitCode } = await runWithoutTty([]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("needs an interactive terminal");
    // The failure this guard exists to prevent.
    expect(stderr).not.toContain("Raw mode is not supported");
    expect(stderr).not.toContain("react-reconciler");
    expect(stderr).not.toMatch(/\bat \S+ \(/);
  }, 30000);

  test("names the commands that do work without a terminal", async () => {
    const { stderr } = await runWithoutTty([]);

    expect(stderr).toContain("--version");
    expect(stderr).toContain("doctor");
  }, 30000);

  test("--version and --help still answer without a TTY", async () => {
    const version = await runWithoutTty(["--version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toContain("kunai");

    const help = await runWithoutTty(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("USAGE");
  }, 30000);
});
