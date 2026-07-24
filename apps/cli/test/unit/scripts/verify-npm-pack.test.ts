import { describe, expect, test } from "bun:test";

import {
  assertNpmPackBudgets,
  assertNpmPackContents,
  forbiddenNpmPackPath,
  NPM_PACK_PACKED_BUDGET_BYTES,
  NPM_PACK_UNPACKED_BUDGET_BYTES,
} from "../../../scripts/build-shared";
import {
  assertNpmPublishManifest,
  parseNpmPackDryRun,
  verifyNpmPackDryRun,
} from "../../../scripts/verify-npm-pack";

describe("forbiddenNpmPackPath", () => {
  test("allows the launcher and package metadata", () => {
    expect(forbiddenNpmPackPath("dist/npm-launcher.mjs")).toBeNull();
    expect(forbiddenNpmPackPath("package.json")).toBeNull();
    expect(forbiddenNpmPackPath("LICENSE")).toBeNull();
  });

  test("rejects the Bun bundle, which is no longer published", () => {
    // `bin` is the Node launcher now. Shipping the Bun-compiled bundle is what
    // made `npm install -g` produce a CLI that could not start without Bun.
    expect(forbiddenNpmPackPath("dist/kunai.js")).toMatch(/allowlist/);
    expect(forbiddenNpmPackPath("dist/kunai.mjs")).toMatch(/allowlist/);
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
  test("passes only for the minimal launcher package", () => {
    expect(() =>
      assertNpmPackContents(["package.json", "dist/npm-launcher.mjs", "LICENSE", "README.md"]),
    ).not.toThrow();
  });

  test("rejects source-package files and compiled binaries", () => {
    expect(() =>
      assertNpmPackContents([
        "package.json",
        "dist/npm-launcher.mjs",
        "LICENSE",
        "README.md",
        "dist/bin/kunai-linux-x64",
      ]),
    ).toThrow("forbidden paths");
  });

  test("requires the launcher, which is the published bin", () => {
    expect(() => assertNpmPackContents(["package.json", "LICENSE"])).toThrow(
      "dist/npm-launcher.mjs",
    );
  });

  test("requires the repository license text", () => {
    expect(() =>
      assertNpmPackContents(["package.json", "dist/npm-launcher.mjs", "README.md"]),
    ).toThrow("LICENSE");
  });

  test("requires the readme npm renders as the package page", () => {
    expect(() =>
      assertNpmPackContents(["package.json", "dist/npm-launcher.mjs", "LICENSE"]),
    ).toThrow("README.md");
  });
});

describe("assertNpmPackBudgets", () => {
  test("passes within budget", () => {
    expect(() => assertNpmPackBudgets(16 * 1024, 32 * 1024)).not.toThrow();
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
npm notice 2.5MB dist/npm-launcher.mjs
npm notice 262.9kB package.json
npm notice Tarball Details
npm notice package size: 1.2 MB
npm notice unpacked size: 3.1 MB
`;
    const summary = parseNpmPackDryRun(stdout);
    expect(summary.paths).toEqual(["LICENSE", "dist/npm-launcher.mjs", "package.json"]);
    expect(summary.packedBytes).toBeGreaterThan(1_000_000);
    expect(summary.unpackedBytes).toBeGreaterThan(3_000_000);
  });
});

describe("verifyNpmPackDryRun", () => {
  test("accepts a small allowlisted pack listing", () => {
    const stdout = `
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 6.0kB README.md
npm notice 6.5kB dist/npm-launcher.mjs
npm notice 5.6kB package.json
npm notice Tarball Details
npm notice package size: 7.2 kB
npm notice unpacked size: 19.4 kB
`;
    expect(() => verifyNpmPackDryRun(stdout)).not.toThrow();
  });
});

describe("assertNpmPublishManifest", () => {
  const minimalManifest = {
    bin: { kunai: "dist/npm-launcher.mjs" },
    files: ["dist/npm-launcher.mjs", "LICENSE", "README.md"],
    engines: { node: ">=18.17" },
    license: "MIT",
    publishConfig: { access: "public", provenance: true },
  };

  test("accepts the Node-only launcher entrypoints", () => {
    expect(() => assertNpmPublishManifest(minimalManifest)).not.toThrow();
  });

  test("rejects workspace runtime metadata and source entrypoints", () => {
    expect(() =>
      assertNpmPublishManifest({
        ...minimalManifest,
        dependencies: { ink: "workspace:*" },
        peerDependencies: { typescript: "workspace:*" },
        module: "dist/kunai.js",
        engines: { bun: ">=1.3.9" },
        bin: { kunai: "dist/kunai.mjs" },
      }),
    ).toThrow(/runtime or peer dependencies/);
  });

  test("rejects missing release policy and lifecycle scripts", () => {
    expect(() => assertNpmPublishManifest({ ...minimalManifest, license: undefined })).toThrow(
      /MIT/,
    );
    expect(() =>
      assertNpmPublishManifest({ ...minimalManifest, publishConfig: undefined }),
    ).toThrow(/public/);
    expect(() =>
      assertNpmPublishManifest({
        ...minimalManifest,
        scripts: { postinstall: "node dist/postinstall.js" },
      }),
    ).toThrow(/lifecycle/);
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
