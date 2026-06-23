import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const BUILD_SCRIPT = join(ROOT, "scripts/build.ts");
const BIN = join(ROOT, "dist/kunai.js");

describe("release npm bundle build", () => {
  test("produces an executable dist/kunai.js via the release build script", async () => {
    const proc = Bun.spawn(["bun", "run", BUILD_SCRIPT], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[build] npm release artifact");
    expect(stdout).toContain("dist/kunai.js");
    expect(existsSync(BIN)).toBe(true);
    expect(readFileSync(BIN, "utf8").startsWith("#!/usr/bin/env bun\n")).toBe(true);
  }, 120_000);
});
