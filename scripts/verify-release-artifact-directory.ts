#!/usr/bin/env bun
/**
 * Verify a local directory holds the exact nine-file release asset set:
 * eight binaries + SHA256SUMS, with matching checksums and optional linux-x64 smoke.
 *
 * Usage:
 *   bun run scripts/verify-release-artifact-directory.ts <dir> --expected-version 0.3.0
 *   bun run scripts/verify-release-artifact-directory.ts <dir> --expected-version 0.3.0 --skip-version-smoke
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_BINARY_ASSET_NAMES,
  assertCompleteReleaseAssetSet,
} from "./release-asset-contract";
import { parseSha256sums } from "./release-binary-checksums";

export type VerifyReleaseArtifactDirectoryInput = {
  readonly directory: string;
  readonly expectedVersion: string;
  /** Skip linux-x64 --version/--help when true (fixtures / non-runnable hosts). */
  readonly skipVersionSmoke?: boolean;
};

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listReleaseFiles(directory: string): readonly { name: string; size: number }[] {
  return readdirSync(directory)
    .filter((name) => {
      try {
        return statSync(join(directory, name)).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => ({
      name,
      size: statSync(join(directory, name)).size,
    }));
}

function smokeLinuxX64(binPath: string, expectedVersion: string): void {
  if (process.platform !== "linux" || process.arch !== "x64") {
    return;
  }

  const version = spawnSync(binPath, ["--version"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
    },
  });
  if (version.status !== 0) {
    throw new Error(
      `[release-assets] kunai-linux-x64 --version failed: ${(version.stderr || version.stdout || "").trim()}`,
    );
  }
  const versionOut = version.stdout.trim();
  if (!versionOut.startsWith("kunai ")) {
    throw new Error(
      `[release-assets] kunai-linux-x64 --version must print kunai semver, got: ${versionOut}`,
    );
  }
  const printed = versionOut.slice("kunai ".length).trim();
  // Accept optional build/channel suffix: "0.2.6 (source (detected))"
  if (printed !== expectedVersion && !printed.startsWith(`${expectedVersion} `)) {
    throw new Error(
      `[release-assets] kunai-linux-x64 --version expected ${expectedVersion}, got ${printed}`,
    );
  }

  const help = spawnSync(binPath, ["--help"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
    },
  });
  if (help.status !== 0) {
    throw new Error(
      `[release-assets] kunai-linux-x64 --help failed: ${(help.stderr || help.stdout || "").trim()}`,
    );
  }
  if (!help.stdout.includes("Kunai")) {
    throw new Error("[release-assets] kunai-linux-x64 --help missing Kunai banner");
  }
}

export async function verifyReleaseArtifactDirectory(
  input: VerifyReleaseArtifactDirectoryInput,
): Promise<void> {
  const files = listReleaseFiles(input.directory);
  assertCompleteReleaseAssetSet(files);

  const sumsPath = join(input.directory, "SHA256SUMS");
  const checksums = parseSha256sums(readFileSync(sumsPath, "utf8"));
  if (checksums.length !== REQUIRED_BINARY_ASSET_NAMES.length) {
    throw new Error(
      `[release-assets] SHA256SUMS must have exactly ${REQUIRED_BINARY_ASSET_NAMES.length} rows, got ${checksums.length}`,
    );
  }

  const byName = new Map(checksums.map((row) => [row.name, row.sha256]));
  if (byName.size !== checksums.length) {
    throw new Error("[release-assets] SHA256SUMS contains duplicate filenames");
  }

  for (const name of REQUIRED_BINARY_ASSET_NAMES) {
    const expected = byName.get(name);
    if (!expected) {
      throw new Error(`[release-assets] SHA256SUMS missing entry for ${name}`);
    }
    const actual = fileSha256(join(input.directory, name));
    if (actual !== expected) {
      throw new Error(
        `[release-assets] sha256 checksum mismatch for ${name}: expected ${expected}, got ${actual}`,
      );
    }
  }

  for (const name of byName.keys()) {
    if (!(REQUIRED_BINARY_ASSET_NAMES as readonly string[]).includes(name)) {
      throw new Error(`[release-assets] SHA256SUMS has unexpected entry: ${name}`);
    }
  }

  if (!input.skipVersionSmoke) {
    smokeLinuxX64(join(input.directory, "kunai-linux-x64"), input.expectedVersion);
  }
}

function parseCliArgs(argv: readonly string[]): {
  directory: string;
  expectedVersion: string;
  skipVersionSmoke: boolean;
} {
  let directory: string | undefined;
  let expectedVersion: string | undefined;
  let skipVersionSmoke = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--expected-version") {
      expectedVersion = argv[++i];
      continue;
    }
    if (arg === "--skip-version-smoke") {
      skipVersionSmoke = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`[release-assets] unknown option: ${arg}`);
    }
    if (directory) {
      throw new Error(`[release-assets] unexpected argument: ${arg}`);
    }
    directory = arg;
  }

  if (!directory) {
    throw new Error(
      "[release-assets] usage: verify-release-artifact-directory.ts <dir> --expected-version <semver> [--skip-version-smoke]",
    );
  }
  if (!expectedVersion) {
    throw new Error("[release-assets] --expected-version <semver> is required");
  }

  return { directory, expectedVersion, skipVersionSmoke };
}

if (import.meta.main) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    await verifyReleaseArtifactDirectory(args);
    console.log(
      `[release-assets] OK — verified ${REQUIRED_BINARY_ASSET_NAMES.length} binaries + SHA256SUMS in ${args.directory}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
