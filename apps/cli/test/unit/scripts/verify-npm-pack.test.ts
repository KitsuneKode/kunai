import { describe, expect, test } from "bun:test";

import {
  assertNpmPackBudgets,
  assertNpmPackContents,
  forbiddenNpmPackPath,
  NPM_PACK_PACKED_BUDGET_BYTES,
  NPM_PACK_UNPACKED_BUDGET_BYTES,
} from "../../../scripts/build-shared";
import { parseNpmPackDryRun, verifyNpmPackDryRun } from "../../../scripts/verify-npm-pack";

describe("forbiddenNpmPackPath", () => {
  test("allows npm bundle and runtime assets", () => {
    expect(forbiddenNpmPackPath("dist/kunai.js")).toBeNull();
    expect(forbiddenNpmPackPath("dist/assets/module1_patched-x88202mw.wasm")).toBeNull();
    expect(forbiddenNpmPackPath("README.md")).toBeNull();
    expect(forbiddenNpmPackPath("LICENSE")).toBeNull();
    expect(forbiddenNpmPackPath("package.json")).toBeNull();
  });

  test("rejects compiled binaries and analyze artifacts", () => {
    expect(forbiddenNpmPackPath("dist/bin/kunai-linux-x64")).toMatch(/binaries/);
    expect(forbiddenNpmPackPath("dist/bin/kunai-linux-x64.meta.json")).toMatch(/binaries/);
    expect(forbiddenNpmPackPath("dist/build-meta.json")).toMatch(/metafiles/);
    expect(forbiddenNpmPackPath("src/main.ts")).toMatch(/allowlist/);
  });
});

describe("assertNpmPackContents", () => {
  test("passes for allowlisted release paths", () => {
    expect(() =>
      assertNpmPackContents([
        "LICENSE",
        "README.md",
        "package.json",
        "dist/kunai.js",
        "dist/assets/kunai-bridge-qvcd1402.lua",
      ]),
    ).not.toThrow();
  });

  test("fails when binaries are present", () => {
    expect(() => assertNpmPackContents(["dist/kunai.js", "dist/bin/kunai-linux-x64"])).toThrow(
      "forbidden paths",
    );
  });
});

describe("assertNpmPackBudgets", () => {
  test("passes within budget", () => {
    expect(() => assertNpmPackBudgets(3 * 1024 * 1024, 4 * 1024 * 1024)).not.toThrow();
  });

  test("fails when packed tarball exceeds budget", () => {
    expect(() => assertNpmPackBudgets(NPM_PACK_PACKED_BUDGET_BYTES + 1, 1024)).toThrow(
      "packed tarball",
    );
  });

  test("fails when unpacked tarball exceeds budget", () => {
    expect(() => assertNpmPackBudgets(1024, NPM_PACK_UNPACKED_BUDGET_BYTES + 1)).toThrow(
      "unpacked tarball",
    );
  });
});

describe("parseNpmPackDryRun", () => {
  test("parses npm notice output", () => {
    const stdout = `
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 2.5MB dist/kunai.js
npm notice 262.9kB dist/assets/module1_patched-x88202mw.wasm
npm notice Tarball Details
npm notice package size: 1.2 MB
npm notice unpacked size: 3.1 MB
`;
    const summary = parseNpmPackDryRun(stdout);
    expect(summary.paths).toEqual([
      "LICENSE",
      "dist/kunai.js",
      "dist/assets/module1_patched-x88202mw.wasm",
    ]);
    expect(summary.packedBytes).toBeGreaterThan(1_000_000);
    expect(summary.unpackedBytes).toBeGreaterThan(3_000_000);
  });
});

describe("verifyNpmPackDryRun", () => {
  test("accepts a small allowlisted pack listing", () => {
    const stdout = `
npm notice Tarball Contents
npm notice 2.5MB dist/kunai.js
npm notice Tarball Details
npm notice package size: 1.2 MB
npm notice unpacked size: 3.1 MB
`;
    expect(() => verifyNpmPackDryRun(stdout)).not.toThrow();
  });
});
