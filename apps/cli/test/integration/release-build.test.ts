import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const BUILD_SCRIPT = join(ROOT, "scripts/build.ts");
const BIN = join(ROOT, "dist/kunai.js");

describe("CLI distribution build", () => {
  test("produces the development app bundle and public launcher package", async () => {
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
    expect(stdout).toContain("[build] CLI build outputs");
    expect(stdout).toContain("dist/npm/dist/npm-launcher.mjs (public launcher)");
    expect(stdout).toContain("dist/npm/LICENSE (public license)");
    expect(stdout).toContain("dist/npm/package.json (public manifest)");
    expect(stdout).toContain("dist/kunai.js (development Bun bundle, unpublished)");
    expect(stdout).toContain("dist/kunai.js");
    expect(existsSync(BIN)).toBe(true);
    expect(readFileSync(BIN, "utf8").startsWith("#!/usr/bin/env bun\n")).toBe(true);
  }, 120_000);
});
