#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "../apps/cli/src/services/update/platform-assets.ts";

const REPO_ROOT = join(import.meta.dirname, "..");
export const DEFAULT_MANIFEST_PATH = join(REPO_ROOT, "apps/cli/package.json");

/** The complete npm binary package set; derived from the canonical release targets. */
export const PLATFORM_PACKAGE_NAMES = RELEASE_BINARY_TARGETS.map(
  (target) => `@kitsunekode/kunai-${target.id}`,
);

type JsonObject = Record<string, unknown>;

export interface PlatformVersionSyncResult {
  readonly manifest: JsonObject;
  readonly changed: boolean;
}

export interface SyncNpmPlatformVersionsOptions {
  readonly manifestPath?: string;
  readonly check?: boolean;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPackageVersion(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const identifier = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
  const prerelease = `(?:-${identifier}(?:\\.${identifier})*)?`;
  const build = "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
  return new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)${prerelease}${build}$`).test(
    value,
  );
}

function readManifest(manifest: unknown): {
  readonly version: string;
  readonly optional: JsonObject;
} {
  if (!isJsonObject(manifest)) {
    throw new Error("package manifest must be a JSON object");
  }
  if (!isValidPackageVersion(manifest.version)) {
    throw new Error(`package manifest has an invalid version: ${String(manifest.version)}`);
  }
  if (!isJsonObject(manifest.optionalDependencies)) {
    throw new Error("package manifest must declare optionalDependencies as an object");
  }
  return { version: manifest.version, optional: manifest.optionalDependencies };
}

function assertExactPlatformPackageSet(optional: JsonObject): void {
  const expected = new Set(PLATFORM_PACKAGE_NAMES);
  const declared = Object.keys(optional);
  const missing = PLATFORM_PACKAGE_NAMES.filter((name) => !Object.hasOwn(optional, name));
  const extra = declared.filter((name) => !expected.has(name));

  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
      extra.length > 0 ? `unexpected: ${extra.join(", ")}` : null,
    ]
      .filter((detail): detail is string => detail !== null)
      .join("; ");
    throw new Error(
      `platform optionalDependencies must match the canonical package set (${details})`,
    );
  }
}

/**
 * Rewrites only the canonical platform pin values. The manifest and nested
 * optionalDependencies insertion order are retained by copying their entries.
 */
export function synchronizePlatformManifest(manifest: unknown): PlatformVersionSyncResult {
  const { version, optional } = readManifest(manifest);
  assertExactPlatformPackageSet(optional);

  const synchronizedOptional = Object.fromEntries(
    Object.entries(optional).map(([name, value]) => [
      name,
      PLATFORM_PACKAGE_NAMES.includes(name) ? version : value,
    ]),
  );
  const changed = Object.entries(optional).some(
    ([name, value]) => synchronizedOptional[name] !== value,
  );

  return {
    manifest: { ...(manifest as JsonObject), optionalDependencies: synchronizedOptional },
    changed,
  };
}

/** Fail when applying the canonical synchronization transform would change the manifest. */
export function assertNpmPlatformVersionsSynchronized(
  manifest: unknown,
): PlatformVersionSyncResult {
  const result = synchronizePlatformManifest(manifest);
  if (result.changed) {
    throw new Error(
      "platform package versions are out of sync; run bun run scripts/sync-npm-platform-versions.ts",
    );
  }
  return result;
}

function readJsonManifest(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not parse package manifest ${path}: ${message}`, { cause: error });
  }
}

/** Synchronize a launcher package manifest, or check it without writing. */
export function syncNpmPlatformVersions(
  options: SyncNpmPlatformVersionsOptions = {},
): PlatformVersionSyncResult {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const manifest = readJsonManifest(manifestPath);
  if (options.check) {
    return assertNpmPlatformVersionsSynchronized(manifest);
  }
  const result = synchronizePlatformManifest(manifest);
  if (result.changed) {
    writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8");
  }
  return result;
}

export function parseSyncNpmPlatformVersionsArgs(args: readonly string[]): {
  readonly check: boolean;
} {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === "--check") return { check: true };
  throw new Error(`unknown arguments: ${args.join(" ")}`);
}

function main(): void {
  const { check } = parseSyncNpmPlatformVersionsArgs(process.argv.slice(2));
  const result = syncNpmPlatformVersions({ check });
  const mode = check ? "verified" : result.changed ? "synchronized" : "already synchronized";
  console.log(
    `[sync-npm-platform-versions] ${mode} ${PLATFORM_PACKAGE_NAMES.length} platform pins.`,
  );
}

if (import.meta.main) {
  main();
}
