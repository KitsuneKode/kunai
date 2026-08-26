import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import cliPackage from "../../../package.json";
import {
  assertNpmPackBudgets,
  assertNpmPackContents,
  forbiddenNpmPackPath,
  NPM_PACK_PACKED_BUDGET_BYTES,
  NPM_PACK_UNPACKED_BUDGET_BYTES,
} from "../../../scripts/build-shared";
import {
  assertNpmPublishManifest,
  buildNpmPackCommand,
  type NpmPublishManifest,
  verifyPreservedNpmTarball,
} from "../../../scripts/verify-npm-pack";
import { RELEASE_BINARY_TARGETS } from "../../../src/services/update/platform-assets";

const TEST_VERSION = "9.8.7";
const TAR_BLOCK_BYTES = 512;

describe("buildNpmPackCommand", () => {
  test("runs npm's JavaScript entrypoint through Node when it is available", () => {
    expect(
      buildNpmPackCommand({
        args: ["pack", "--dry-run"],
        npmPath: "/toolchain/bin/npm",
        nodePath: "/toolchain/bin/node",
        npmCliPath: "/toolchain/lib/node_modules/npm/bin/npm-cli.js",
      }),
    ).toEqual([
      "/toolchain/bin/node",
      "/toolchain/lib/node_modules/npm/bin/npm-cli.js",
      "pack",
      "--dry-run",
    ]);
  });

  test("falls back to the npm executable when its JavaScript entrypoint is unavailable", () => {
    expect(
      buildNpmPackCommand({
        args: ["pack"],
        npmPath: "/toolchain/bin/npm",
        nodePath: null,
        npmCliPath: null,
      }),
    ).toEqual(["/toolchain/bin/npm", "pack"]);
  });
});

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function fixtureTar(entries: readonly (readonly [path: string, contents: string])[]): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, contents] of entries) {
    const data = Buffer.from(contents);
    const header = Buffer.alloc(TAR_BLOCK_BYTES);
    header.write(path, 0, 100, "utf8");
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, data.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header, data);
    const paddingBytes = (TAR_BLOCK_BYTES - (data.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if (paddingBytes > 0) blocks.push(Buffer.alloc(paddingBytes));
  }
  blocks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2));
  return Buffer.concat(blocks);
}

function minimalManifest(overrides: Partial<NpmPublishManifest> = {}): NpmPublishManifest {
  return {
    name: "@kitsunekode/kunai",
    version: TEST_VERSION,
    type: "module",
    bin: { kunai: "dist/npm-launcher.mjs" },
    files: ["dist/npm-launcher.mjs", "LICENSE", "README.md"],
    engines: { node: ">=18.17" },
    license: "MIT",
    optionalDependencies: Object.fromEntries(
      RELEASE_BINARY_TARGETS.map((target) => [`@kitsunekode/kunai-${target.id}`, TEST_VERSION]),
    ),
    publishConfig: { access: "public", provenance: true },
    ...overrides,
  };
}

async function withFixtureTarball(
  files: ReadonlyMap<string, string>,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "kunai-npm-tarball-test-"));
  const path = join(directory, "candidate.tgz");
  try {
    const tarBytes = await new Bun.Archive(Object.fromEntries(files)).bytes();
    await Bun.write(path, gzipSync(tarBytes));
    await run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function withOrderedFixtureTarball(
  entries: readonly (readonly [path: string, contents: string])[],
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "kunai-npm-ordered-tarball-test-"));
  const path = join(directory, "candidate.tgz");
  try {
    await Bun.write(path, gzipSync(fixtureTar(entries)));
    await run(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function fixtureFiles(
  overrides: readonly (readonly [path: string, contents: string | null])[] = [],
): ReadonlyMap<string, string> {
  const files = new Map<string, string>([
    ["package/package.json", JSON.stringify(minimalManifest())],
    ["package/LICENSE", "MIT\n"],
    ["package/README.md", "# Kunai\n"],
    ["package/dist/npm-launcher.mjs", "#!/usr/bin/env node\n"],
  ]);
  for (const [path, contents] of overrides) {
    if (contents === null) files.delete(path);
    else files.set(path, contents);
  }
  return files;
}

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

describe("assertNpmPublishManifest", () => {
  test("accepts the Node-only launcher entrypoints", () => {
    expect(() => assertNpmPublishManifest(minimalManifest(), TEST_VERSION)).not.toThrow();
  });

  test("rejects workspace runtime metadata and source entrypoints", () => {
    expect(() =>
      assertNpmPublishManifest(
        minimalManifest({
          dependencies: { ink: "workspace:*" },
          peerDependencies: { typescript: "workspace:*" },
          module: "dist/kunai.js",
          engines: { bun: ">=1.3.9" },
          bin: { kunai: "dist/kunai.mjs" },
        }),
        TEST_VERSION,
      ),
    ).toThrow(/runtime or peer dependencies/);
  });

  test("rejects missing release policy and lifecycle scripts", () => {
    expect(() =>
      assertNpmPublishManifest(minimalManifest({ license: undefined }), TEST_VERSION),
    ).toThrow(/MIT/);
    expect(() =>
      assertNpmPublishManifest(minimalManifest({ publishConfig: undefined }), TEST_VERSION),
    ).toThrow(/public/);
    expect(() =>
      assertNpmPublishManifest(
        minimalManifest({ scripts: { postinstall: "node dist/postinstall.js" } }),
        TEST_VERSION,
      ),
    ).toThrow(/lifecycle/);
  });

  test("requires the exact package identity and platform dependency set", () => {
    expect(() =>
      assertNpmPublishManifest(minimalManifest({ name: "kunai" }), TEST_VERSION),
    ).toThrow(/name/);
    expect(() =>
      assertNpmPublishManifest(minimalManifest({ version: "9.8.6" }), TEST_VERSION),
    ).toThrow(/version/);
    expect(() =>
      assertNpmPublishManifest(minimalManifest({ optionalDependencies: {} }), TEST_VERSION),
    ).toThrow(/optional dependencies/);
  });
});

describe("verifyPreservedNpmTarball", () => {
  test("accepts the exact four-file Bun-packed launcher tarball", async () => {
    await withFixtureTarball(fixtureFiles(), async (path) => {
      const summary = await verifyPreservedNpmTarball(path, TEST_VERSION);
      expect(summary.paths).toEqual([
        "LICENSE",
        "README.md",
        "dist/npm-launcher.mjs",
        "package.json",
      ]);
      expect(summary.packedBytes).toBeGreaterThan(0);
      expect(summary.unpackedBytes).toBeGreaterThan(0);
    });
  });

  test("rejects the preserved artifact when README is missing", async () => {
    await withFixtureTarball(fixtureFiles([["package/README.md", null]]), async (path) => {
      await expect(verifyPreservedNpmTarball(path, TEST_VERSION)).rejects.toThrow("README.md");
    });
  });

  test("rejects an extra source file or compiled binary in the exact artifact", async () => {
    for (const forbiddenPath of ["package/src/main.ts", "package/dist/bin/kunai-linux-x64"]) {
      await withFixtureTarball(fixtureFiles([[forbiddenPath, "forbidden\n"]]), async (path) => {
        await expect(verifyPreservedNpmTarball(path, TEST_VERSION)).rejects.toThrow(
          /forbidden paths/,
        );
      });
    }
  });

  test("validates the manifest embedded in the preserved bytes", async () => {
    const embedded = JSON.stringify(
      minimalManifest({ scripts: { postinstall: "node dist/postinstall.js" } }),
    );
    await withFixtureTarball(fixtureFiles([["package/package.json", embedded]]), async (path) => {
      await expect(verifyPreservedNpmTarball(path, TEST_VERSION)).rejects.toThrow(/lifecycle/);
    });
  });

  test("rejects duplicate archive members before path-keyed extraction can collapse them", async () => {
    const entries = [...fixtureFiles().entries(), ["package/README.md", "replacement\n"]] as const;
    await withOrderedFixtureTarball(entries, async (path) => {
      await expect(verifyPreservedNpmTarball(path, TEST_VERSION)).rejects.toThrow(
        /duplicate.*package\/README\.md/i,
      );
    });
  });

  test("rejects duplicate manifests even when the surviving copy is policy-safe", async () => {
    const unsafeManifest = JSON.stringify(
      minimalManifest({ scripts: { postinstall: "node dist/postinstall.js" } }),
    );
    const entries = [
      ["package/package.json", unsafeManifest],
      ...[...fixtureFiles().entries()].filter(([path]) => path !== "package/package.json"),
      ["package/package.json", JSON.stringify(minimalManifest())],
    ] as const;
    await withOrderedFixtureTarball(entries, async (path) => {
      await expect(verifyPreservedNpmTarball(path, TEST_VERSION)).rejects.toThrow(
        /duplicate.*package\/package\.json/i,
      );
    });
  });

  test("bounds decompression before a compressed artifact can exceed the unpacked budget", async () => {
    const entries = [...fixtureFiles().entries()].map(([path, contents]) =>
      path === "package/README.md"
        ? ([path, "x".repeat(NPM_PACK_UNPACKED_BUDGET_BYTES * 2)] as const)
        : ([path, contents] as const),
    );
    await withOrderedFixtureTarball(entries, async (path) => {
      await expect(verifyPreservedNpmTarball(path, TEST_VERSION)).rejects.toThrow(
        /could not be read.*larger than/i,
      );
    });
  });
});

describe("platform package contract", () => {
  test("every optionalDependency is a platform package pinned to this exact version", async () => {
    const optional = cliPackage.optionalDependencies ?? {};

    // The launcher resolves `@kitsunekode/kunai-<targetId>` at runtime. Version
    // skew between the launcher and its platform packages is the classic failure
    // of this layout: npm resolves a binary from a different release, or none.
    expect(Object.keys(optional).length).toBeGreaterThan(0);
    for (const [name, range] of Object.entries(optional)) {
      expect(name.startsWith("@kitsunekode/kunai-"), name).toBe(true);
      expect(range, name).toBe(cliPackage.version);
    }

    // bin must be the Node launcher, never the Bun bundle.
    expect(cliPackage.bin?.kunai).toBe("dist/kunai.mjs");
  });

  test("optionalDependencies cover exactly the published binary targets", async () => {
    const declared = Object.keys(cliPackage.optionalDependencies ?? {}).sort();
    const expected = RELEASE_BINARY_TARGETS.map((t) => `@kitsunekode/kunai-${t.id}`).sort();
    // A target built but not declared is unreachable from npm; a target declared
    // but not built resolves to a package that will never be published.
    expect(declared).toEqual(expected);
  });
});
