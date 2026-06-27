import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CLI_ROOT = join(import.meta.dirname, "../..");
const STUB_BIN = join(CLI_ROOT, "dist/bin/kunai-linux-x64-stub-for-pack-guard");

describe("npm pack guard with binaries on disk", () => {
  test("pkg:check passes when dist/bin exists but is excluded from the tarball", async () => {
    await mkdir(join(CLI_ROOT, "dist/bin"), { recursive: true });
    await writeFile(STUB_BIN, "not-a-real-binary\n");

    try {
      const result = spawnSync("bun", ["run", "scripts/verify-npm-pack.ts"], {
        cwd: CLI_ROOT,
        encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(result.status).toBe(0);
      expect(output).toContain("[pkg:check] ok");
      expect(output).not.toContain("dist/bin/");
    } finally {
      await rm(STUB_BIN, { force: true });
    }
  });
});
