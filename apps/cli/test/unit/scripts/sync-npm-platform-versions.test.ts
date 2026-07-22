import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");
const SCRIPT_PATH = "../../../../../scripts/sync-npm-platform-versions.ts";
const GUARD_PATH = "../../../../../scripts/release-guard.ts";

async function syncModule() {
  return import(SCRIPT_PATH);
}

function validManifest(version = "1.2.3") {
  return {
    name: "@kitsunekode/kunai",
    version,
    private: false,
    optionalDependencies: Object.fromEntries(
      RELEASE_BINARY_TARGETS.map((target) => [`@kitsunekode/kunai-${target.id}`, version]),
    ),
  };
}

describe("npm platform version synchronization", () => {
  test("derives exactly the eight published platform package names from canonical targets", async () => {
    const { PLATFORM_PACKAGE_NAMES } = await syncModule();

    expect(PLATFORM_PACKAGE_NAMES).toEqual(
      RELEASE_BINARY_TARGETS.map((target) => `@kitsunekode/kunai-${target.id}`),
    );
    expect(PLATFORM_PACKAGE_NAMES).toHaveLength(8);
  });

  test("rejects missing or extra platform pins instead of changing the package set", async () => {
    const { synchronizePlatformManifest } = await syncModule();
    const missing = validManifest();
    delete missing.optionalDependencies["@kitsunekode/kunai-linux-x64"];
    const extra = validManifest();
    extra.optionalDependencies["left-pad"] = "1.3.0";

    expect(() => synchronizePlatformManifest(missing)).toThrow(/missing/i);
    expect(() => synchronizePlatformManifest(extra)).toThrow(/unexpected|extra/i);
  });

  test("rejects ranges and skew when checking platform pins", async () => {
    const { assertNpmPlatformVersionsSynchronized } = await syncModule();
    const ranged = validManifest();
    ranged.optionalDependencies["@kitsunekode/kunai-linux-x64"] = "^1.2.3";
    const skewed = validManifest();
    skewed.optionalDependencies["@kitsunekode/kunai-linux-x64"] = "1.2.2";

    expect(() => assertNpmPlatformVersionsSynchronized(ranged)).toThrow(/out of sync/i);
    expect(() => assertNpmPlatformVersionsSynchronized(skewed)).toThrow(/out of sync/i);
  });

  test("rewrites only canonical platform pin values to the launcher version", async () => {
    const { synchronizePlatformManifest } = await syncModule();
    const manifest = validManifest("2.0.0");
    manifest.optionalDependencies["@kitsunekode/kunai-linux-x64"] = "^1.9.0";
    manifest.optionalDependencies["@kitsunekode/kunai-windows-x64"] = "1.9.0";
    const result = synchronizePlatformManifest(manifest);

    expect(result.changed).toBe(true);
    expect(result.manifest).toEqual({
      ...manifest,
      optionalDependencies: Object.fromEntries(
        RELEASE_BINARY_TARGETS.map((target) => [`@kitsunekode/kunai-${target.id}`, "2.0.0"]),
      ),
    });
  });

  test("rejects an invalid launcher package version", async () => {
    const { synchronizePlatformManifest } = await syncModule();

    expect(() => synchronizePlatformManifest(validManifest("not-a-version"))).toThrow(/version/i);
  });

  test("check mode detects skew without writing the manifest", async () => {
    const { syncNpmPlatformVersions } = await syncModule();
    const tempDir = mkdtempSync(join(tmpdir(), "kunai-platform-pins-"));
    const manifestPath = join(tempDir, "package.json");
    const manifest = validManifest();
    manifest.optionalDependencies["@kitsunekode/kunai-linux-x64"] = "^1.2.3";
    const original = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestPath, original, "utf8");

    try {
      expect(() => syncNpmPlatformVersions({ manifestPath, check: true })).toThrow(/out of sync/i);
      expect(readFileSync(manifestPath, "utf8")).toBe(original);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("normal mode writes stable JSON once and preserves unrelated field order", async () => {
    const { syncNpmPlatformVersions } = await syncModule();
    const tempDir = mkdtempSync(join(tmpdir(), "kunai-platform-pins-write-"));
    const manifestPath = join(tempDir, "package.json");
    const manifest = validManifest("2.1.0");
    manifest.optionalDependencies["@kitsunekode/kunai-linux-x64"] = "2.0.0";
    const source = JSON.stringify({ before: "kept", ...manifest, after: { nested: true } });
    writeFileSync(manifestPath, source, "utf8");

    try {
      expect(syncNpmPlatformVersions({ manifestPath }).changed).toBe(true);
      const firstWrite = readFileSync(manifestPath, "utf8");
      const written = JSON.parse(firstWrite) as Record<string, unknown>;
      expect(firstWrite).toBe(`${JSON.stringify(written, null, 2)}\n`);
      expect(Object.keys(written)).toEqual([
        "before",
        "name",
        "version",
        "private",
        "optionalDependencies",
        "after",
      ]);
      expect(written.before).toBe("kept");
      expect(written.after).toEqual({ nested: true });

      expect(syncNpmPlatformVersions({ manifestPath }).changed).toBe(false);
      expect(readFileSync(manifestPath, "utf8")).toBe(firstWrite);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("release guard platform pin contract", () => {
  test("calls the same pure synchronization check used by file check mode", async () => {
    const guardSource = readFileSync(join(REPO_ROOT, "scripts/release-guard.ts"), "utf8");

    expect(guardSource).toContain("assertNpmPlatformVersionsSynchronized(packageManifest)");
    expect(guardSource).not.toContain("assertExactPlatformVersions");
  });

  test("reports exact platform pin drift through the shared check", async () => {
    const { collectReleaseGuardErrors } = await import(GUARD_PATH);
    const manifest = validManifest("1.2.3");
    manifest.optionalDependencies["@kitsunekode/kunai-linux-x64"] = "^1.2.3";

    expect(
      collectReleaseGuardErrors({
        packageManifest: manifest,
        cliChangelog: "## 1.2.3\n",
        rootChangelog: "## v1.2.3\n",
        changesetFiles: [],
      }),
    ).toContainEqual(expect.stringMatching(/platform|exact|optional/i));
  });
});

describe("version:packages contract", () => {
  test("synchronizes platform pins immediately after Changesets versioning", () => {
    const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const command = rootPackage.scripts["version:packages"];

    expect(command).toMatch(
      /^bunx changeset version && bun run scripts\/sync-npm-platform-versions\.ts && bun run scripts\/sync-root-changelog\.ts && bun run release:notes$/,
    );
  });
});
