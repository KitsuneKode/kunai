import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertRequiredReleaseAssets,
} from "../../../../../scripts/release-asset-contract";

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
