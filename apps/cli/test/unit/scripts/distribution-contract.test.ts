import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertCompleteReleaseAssetSet,
  assertRequiredReleaseAssets,
} from "../../../../../scripts/release-asset-contract";
import { shouldWriteReleaseChecksums } from "../../../../../scripts/release-binary-checksums";
import { verifyReleaseArtifactDirectory } from "../../../../../scripts/verify-release-artifact-directory";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");
const requiredAssetNames = REQUIRED_RELEASE_ASSET_NAMES;
const requiredBinaryNames = RELEASE_BINARY_TARGETS.map((t) => t.out).sort();

function completeSizedAssets(size = 1) {
  return requiredAssetNames.map((name) => ({ name, size }));
}

describe("distribution release-asset contract", () => {
  test("required assets are RELEASE_BINARY_TARGETS outs plus SHA256SUMS", () => {
    expect([...REQUIRED_RELEASE_ASSET_NAMES]).toEqual(
      [...RELEASE_BINARY_TARGETS.map((t) => t.out), "SHA256SUMS"].sort(),
    );
    expect(REQUIRED_RELEASE_ASSET_NAMES).toHaveLength(RELEASE_BINARY_TARGETS.length + 1);
  });

  test("assertRequiredReleaseAssets accepts a complete set and rejects gaps", () => {
    expect(() => assertRequiredReleaseAssets(REQUIRED_RELEASE_ASSET_NAMES)).not.toThrow();
    expect(() => assertRequiredReleaseAssets(["SHA256SUMS"])).toThrow(/missing/);
  });

  test("assertCompleteReleaseAssetSet accepts a complete non-empty set", () => {
    expect(() => assertCompleteReleaseAssetSet(completeSizedAssets())).not.toThrow();
  });

  test("rejects a zero-byte required asset", () => {
    expect(() =>
      assertCompleteReleaseAssetSet(
        requiredAssetNames.map((name) => ({ name, size: name === "kunai-linux-x64" ? 0 : 1 })),
      ),
    ).toThrow("kunai-linux-x64");
  });

  test("rejects a missing required asset", () => {
    expect(() =>
      assertCompleteReleaseAssetSet(
        completeSizedAssets().filter((asset) => asset.name !== "SHA256SUMS"),
      ),
    ).toThrow(/missing/);
  });

  test("rejects an unexpected asset", () => {
    expect(() =>
      assertCompleteReleaseAssetSet([...completeSizedAssets(), { name: "extra.bin", size: 1 }]),
    ).toThrow(/unexpected/);
  });

  test("rejects a duplicate asset name", () => {
    expect(() =>
      assertCompleteReleaseAssetSet([
        ...completeSizedAssets(),
        { name: "kunai-linux-x64", size: 1 },
      ]),
    ).toThrow(/duplicate/);
  });

  test("release.yml uploads every required asset and fails on unmatched files", () => {
    const release = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
    expect(release).toContain("fail_on_unmatched_files: true");
    for (const name of REQUIRED_RELEASE_ASSET_NAMES) {
      expect(release).toContain(`apps/cli/dist/bin/${name}`);
    }
    expect(release).toContain("verify-github-release-assets.ts");
  });

  test("build-binaries.yml errors when artifact files are missing", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/build-binaries.yml"), "utf8");
    expect(workflow).toMatch(/if-no-files-found:\s*error/);
    for (const name of REQUIRED_RELEASE_ASSET_NAMES) {
      expect(workflow).toContain(`apps/cli/dist/bin/${name}`);
    }
  });
});

describe("verifyReleaseArtifactDirectory", () => {
  test("accepts a fixture with eight checksum rows and matching hashes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      const sums: string[] = [];
      for (const name of requiredBinaryNames) {
        const body = `payload:${name}\n`;
        writeFileSync(join(dir, name), body);
        sums.push(`${createHash("sha256").update(body).digest("hex")}  ${name}`);
      }
      writeFileSync(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects checksum mismatch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      const sums: string[] = [];
      for (const name of requiredBinaryNames) {
        writeFileSync(join(dir, name), `payload:${name}\n`);
        sums.push(`${"a".repeat(64)}  ${name}`);
      }
      writeFileSync(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).rejects.toThrow(/checksum|sha256/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects SHA256SUMS with the wrong row count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      for (const name of requiredBinaryNames) {
        writeFileSync(join(dir, name), `payload:${name}\n`);
      }
      writeFileSync(join(dir, "SHA256SUMS"), `${"a".repeat(64)}  kunai-linux-x64\n`);

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).rejects.toThrow(/8/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("release checksum authorship", () => {
  // A local build produces binaries that are byte-different from CI's, so
  // merging its SHA256SUMS replaced the committed hashes with ones no published
  // artifact can match. That file is what users verify a download against.
  test("a local build does not author release checksums", () => {
    expect(shouldWriteReleaseChecksums({})).toBe(false);
    expect(shouldWriteReleaseChecksums({ CI: "" })).toBe(false);
    expect(shouldWriteReleaseChecksums({ CI: "   " })).toBe(false);
  });

  test("CI authors them", () => {
    expect(shouldWriteReleaseChecksums({ CI: "true" })).toBe(true);
    expect(shouldWriteReleaseChecksums({ CI: "1" })).toBe(true);
  });

  test("an explicit opt-in authors them outside CI", () => {
    expect(shouldWriteReleaseChecksums({ KUNAI_WRITE_RELEASE_CHECKSUMS: "1" })).toBe(true);
  });
});
