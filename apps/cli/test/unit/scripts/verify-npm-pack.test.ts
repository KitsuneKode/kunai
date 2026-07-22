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
  test("allows the launcher and package metadata", () => {
    expect(forbiddenNpmPackPath("dist/kunai.mjs")).toBeNull();
    expect(forbiddenNpmPackPath("README.md")).toBeNull();
    expect(forbiddenNpmPackPath("LICENSE")).toBeNull();
    expect(forbiddenNpmPackPath("package.json")).toBeNull();
  });

  test("rejects the Bun bundle, which is no longer published", () => {
    // `bin` is the Node launcher now. Shipping the Bun-compiled bundle is what
    // made `npm install -g` produce a CLI that could not start without Bun.
    expect(forbiddenNpmPackPath("dist/kunai.js")).toMatch(/allowlist/);
    expect(forbiddenNpmPackPath("dist/postinstall.js")).toMatch(/allowlist/);
    // Assets are embedded in each platform binary, so they are dead weight here.
    expect(forbiddenNpmPackPath("dist/assets/module1_patched-x88202mw.wasm")).toMatch(/allowlist/);
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
      assertNpmPackContents(["LICENSE", "README.md", "package.json", "dist/kunai.mjs"]),
    ).not.toThrow();
  });

  test("fails when binaries are present", () => {
    expect(() => assertNpmPackContents(["dist/kunai.mjs", "dist/bin/kunai-linux-x64"])).toThrow(
      "forbidden paths",
    );
  });

  test("requires the launcher, which is the published bin", () => {
    expect(() => assertNpmPackContents(["package.json"])).toThrow("dist/kunai.mjs");
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
npm notice 1.1kB LICENSE
npm notice 6.5kB dist/kunai.mjs
npm notice 5.6kB package.json
npm notice Tarball Details
npm notice package size: 7.2 kB
npm notice unpacked size: 19.4 kB
`;
    expect(() => verifyNpmPackDryRun(stdout)).not.toThrow();
  });
});

describe("platform package contract", () => {
  test("every optionalDependency is a platform package pinned to this exact version", async () => {
    const cli = (await import("../../../package.json", { with: { type: "json" } })).default as {
      version: string;
      optionalDependencies?: Record<string, string>;
      bin?: Record<string, string>;
    };
    const optional = cli.optionalDependencies ?? {};

    // The launcher resolves `@kitsunekode/kunai-<targetId>` at runtime. Version
    // skew between the launcher and its platform packages is the classic failure
    // of this layout: npm resolves a binary from a different release, or none.
    expect(Object.keys(optional).length).toBeGreaterThan(0);
    for (const [name, range] of Object.entries(optional)) {
      expect(name.startsWith("@kitsunekode/kunai-"), name).toBe(true);
      expect(range, name).toBe(cli.version);
    }

    // bin must be the Node launcher, never the Bun bundle.
    expect(cli.bin?.kunai).toBe("dist/kunai.mjs");
  });

  test("optionalDependencies cover exactly the published binary targets", async () => {
    const { RELEASE_BINARY_TARGETS } = await import("../../../src/services/update/platform-assets");
    const cli = (await import("../../../package.json", { with: { type: "json" } })).default as {
      optionalDependencies?: Record<string, string>;
    };

    const declared = Object.keys(cli.optionalDependencies ?? {}).sort();
    const expected = RELEASE_BINARY_TARGETS.map((t) => `@kitsunekode/kunai-${t.id}`).sort();
    // A target built but not declared is unreachable from npm; a target declared
    // but not built resolves to a package that will never be published.
    expect(declared).toEqual(expected);
  });
});
