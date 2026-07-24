import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CLI_ROOT = join(import.meta.dirname, "../..");
const REPO_ROOT = join(CLI_ROOT, "../..");
const NPM_PUBLISH_ROOT = join(CLI_ROOT, "dist/npm");
const STUB_BIN = join(CLI_ROOT, "dist/bin/kunai-linux-x64-stub-for-pack-guard");
const RELEASE_TARBALL = join(REPO_ROOT, ".release-candidate/kunai-npm.tgz");

describe("npm pack guard with binaries on disk", () => {
  test("builds and release-packs only the policy-safe launcher files", async () => {
    const tarballBackup = `${RELEASE_TARBALL}.test-backup-${process.pid}`;
    const hadExistingTarball = existsSync(RELEASE_TARBALL);
    if (hadExistingTarball) {
      await rename(RELEASE_TARBALL, tarballBackup);
    }

    try {
      const build = spawnSync("bun", ["run", "build"], {
        cwd: CLI_ROOT,
        encoding: "utf8",
      });
      expect(build.status, `${build.stdout ?? ""}${build.stderr ?? ""}`).toBe(0);

      const manifest = JSON.parse(readFileSync(join(NPM_PUBLISH_ROOT, "package.json"), "utf8"));
      expect(manifest).toMatchObject({
        license: "MIT",
        publishConfig: { access: "public", provenance: true },
        files: ["dist/npm-launcher.mjs", "LICENSE", "README.md"],
      });
      expect(existsSync(join(NPM_PUBLISH_ROOT, "LICENSE"))).toBe(true);
      expect(readFileSync(join(NPM_PUBLISH_ROOT, "LICENSE"), "utf8")).toBe(
        readFileSync(join(REPO_ROOT, "LICENSE"), "utf8"),
      );

      // The CLI readme, not the repository one: npm renders this as the package
      // page, and the root readme is monorepo-shaped and past the pack budget.
      expect(existsSync(join(NPM_PUBLISH_ROOT, "README.md"))).toBe(true);
      expect(readFileSync(join(NPM_PUBLISH_ROOT, "README.md"), "utf8")).toBe(
        readFileSync(join(CLI_ROOT, "README.md"), "utf8"),
      );

      await mkdir(join(CLI_ROOT, "dist/bin"), { recursive: true });
      await writeFile(STUB_BIN, "not-a-real-binary\n");
      const result = spawnSync("bun", ["run", "scripts/verify-npm-pack.ts"], {
        cwd: CLI_ROOT,
        encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(result.status).toBe(0);
      expect(output).toContain("[pkg:check] ok");
      expect(output).not.toContain("dist/bin/");

      const pack = spawnSync("bun", ["run", "release:pack"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      expect(pack.status, `${pack.stdout ?? ""}${pack.stderr ?? ""}`).toBe(0);
      expect(existsSync(RELEASE_TARBALL)).toBe(true);
      expect(statSync(RELEASE_TARBALL).size).toBeGreaterThan(0);
    } finally {
      await rm(STUB_BIN, { force: true });
      await rm(RELEASE_TARBALL, { force: true });
      if (hadExistingTarball) {
        await rename(tarballBackup, RELEASE_TARBALL);
      }
    }
  }, 120_000);
});
