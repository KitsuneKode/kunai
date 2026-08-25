#!/usr/bin/env bun
/**
 * Verify a local directory holds the exact 0.3.0 bridge set:
 * eight archives, eight raw binaries, and two matching checksum manifests.
 *
 * Usage:
 *   bun run scripts/verify-release-artifact-directory.ts <dir> --expected-version 0.3.0
 *   bun run scripts/verify-release-artifact-directory.ts <dir> --expected-version 0.3.0 --skip-version-smoke
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyBuiltReleaseArchives } from "../apps/cli/scripts/build-release-archives";
import {
  REQUIRED_ARCHIVE_ASSET_NAMES,
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

export function listRegularReleaseFiles(
  directory: string,
): readonly { name: string; size: number }[] {
  return readdirSync(directory)
    .sort()
    .map((name) => {
      const stat = lstatSync(join(directory, name));
      if (!stat.isFile()) {
        throw new Error(`[release-assets] unexpected non-regular entry: ${name}`);
      }
      return { name, size: stat.size };
    });
}

export function smokeReleaseLinuxX64(directory: string, expectedVersion: string): void {
  if (process.platform !== "linux" || process.arch !== "x64") {
    return;
  }

  const binPath = join(directory, "kunai-linux-x64");

  // GitHub artifact and release downloads intentionally do not preserve Unix
  // executable mode. Restoring the mode changes filesystem metadata, not the
  // verified bytes; archive mode is checked independently as canonical 0755.
  chmodSync(binPath, 0o755);

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
  const files = listRegularReleaseFiles(input.directory);
  assertCompleteReleaseAssetSet(files);

  verifyChecksumManifest(input.directory, "SHA256SUMS", REQUIRED_BINARY_ASSET_NAMES);
  verifyChecksumManifest(input.directory, "SHA256SUMS.archives", REQUIRED_ARCHIVE_ASSET_NAMES);
  verifyBuiltReleaseArchives(input.directory);

  if (!input.skipVersionSmoke) {
    smokeReleaseLinuxX64(input.directory, input.expectedVersion);
  }
}

function verifyChecksumManifest(
  directory: string,
  manifestName: string,
  requiredNames: readonly string[],
): void {
  const checksums = parseSha256sums(readFileSync(join(directory, manifestName), "utf8"));
  if (checksums.length !== requiredNames.length) {
    throw new Error(
      `[release-assets] ${manifestName} must have exactly ${requiredNames.length} rows, got ${checksums.length}`,
    );
  }
  const byName = new Map(checksums.map((row) => [row.name, row.sha256]));
  if (byName.size !== checksums.length) {
    throw new Error(`[release-assets] ${manifestName} contains duplicate filenames`);
  }
  const sortedNames = [...requiredNames].sort();
  if (checksums.some((row, index) => row.name !== sortedNames[index])) {
    throw new Error(`[release-assets] ${manifestName} rows must use exact sorted filenames`);
  }
  for (const name of sortedNames) {
    const expected = byName.get(name);
    if (!expected) {
      throw new Error(`[release-assets] ${manifestName} missing entry for ${name}`);
    }
    const actual = fileSha256(join(directory, name));
    if (actual !== expected) {
      throw new Error(
        `[release-assets] sha256 checksum mismatch for ${name}: expected ${expected}, got ${actual}`,
      );
    }
  }
  for (const name of byName.keys()) {
    if (!requiredNames.includes(name)) {
      throw new Error(`[release-assets] ${manifestName} has unexpected entry: ${name}`);
    }
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
      `[release-assets] OK — verified 8 archives + 8 raw binaries + 2 manifests in ${args.directory}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
