import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertRequiredReleaseAssets,
} from "../../../../../scripts/release-asset-contract";
import { shouldWriteReleaseChecksums } from "../../../../../scripts/release-binary-checksums";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");

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
