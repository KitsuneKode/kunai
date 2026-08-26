#!/usr/bin/env bun
// Verify the published npm tarball stays small and never includes compiled binaries.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

import { RELEASE_BINARY_TARGETS } from "../src/services/update/platform-assets";
import {
  assertNpmPackBudgets,
  assertNpmPackContents,
  formatBuildSize,
  NPM_PACK_PACKED_BUDGET_BYTES,
  NPM_PACK_UNPACKED_BUDGET_BYTES,
} from "./build-shared";

const ROOT = join(import.meta.dirname, "..");
const NPM_PUBLISH_ROOT = join(ROOT, "dist/npm");
const TAR_BLOCK_BYTES = 512;
const TAR_NAME_OFFSET = 0;
const TAR_NAME_BYTES = 100;
const TAR_SIZE_OFFSET = 124;
const TAR_SIZE_BYTES = 12;
const TAR_CHECKSUM_OFFSET = 148;
const TAR_CHECKSUM_BYTES = 8;
const TAR_TYPE_OFFSET = 156;
const TAR_PREFIX_OFFSET = 345;
const TAR_PREFIX_BYTES = 155;
const TAR_REGULAR_FILE = 0x30;
const TAR_SPACE = 0x20;
const TAR_CONTAINER_BUDGET_BYTES = NPM_PACK_UNPACKED_BUDGET_BYTES + TAR_BLOCK_BYTES * 16;
const textDecoder = new TextDecoder();

export type NpmPublishManifest = {
  readonly bin?: Record<string, string>;
  readonly dependencies?: unknown;
  readonly engines?: Record<string, string>;
  readonly files?: string[];
  readonly license?: string;
  readonly module?: unknown;
  readonly name?: string;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: unknown;
  readonly publishConfig?: {
    readonly access?: string;
    readonly provenance?: boolean;
  };
  readonly scripts?: unknown;
  readonly type?: string;
  readonly version?: string;
};

/** Reject workspace-only metadata before checking the generated tarball. */
export function assertNpmPublishManifest(
  manifest: NpmPublishManifest,
  expectedVersion: string,
): void {
  if (manifest.name !== "@kitsunekode/kunai") {
    throw new Error("[pkg:check] npm publish manifest has the wrong package name.");
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `[pkg:check] npm publish manifest version must be ${expectedVersion}, received ${manifest.version ?? "missing"}.`,
    );
  }
  if (manifest.type !== "module") {
    throw new Error("[pkg:check] npm publish manifest type must be module.");
  }
  if (manifest.dependencies !== undefined || manifest.peerDependencies !== undefined) {
    throw new Error(
      "[pkg:check] npm publish manifest must not contain runtime or peer dependencies.",
    );
  }
  if (manifest.module !== undefined) {
    throw new Error("[pkg:check] npm publish manifest must not contain a module entrypoint.");
  }
  if (manifest.engines?.bun !== undefined) {
    throw new Error("[pkg:check] npm publish manifest must not require Bun.");
  }
  if (
    manifest.engines?.node !== ">=18.17" ||
    Object.keys(manifest.engines ?? {}).some((engine) => engine !== "node")
  ) {
    throw new Error("[pkg:check] npm publish manifest must require only Node >=18.17.");
  }
  if (manifest.scripts !== undefined) {
    throw new Error("[pkg:check] npm publish manifest must not contain lifecycle scripts.");
  }
  if (manifest.bin?.kunai !== "dist/npm-launcher.mjs") {
    throw new Error("[pkg:check] npm publish manifest must use dist/npm-launcher.mjs as its bin.");
  }
  if (
    manifest.files?.length !== 3 ||
    manifest.files[0] !== "dist/npm-launcher.mjs" ||
    manifest.files[1] !== "LICENSE" ||
    manifest.files[2] !== "README.md"
  ) {
    throw new Error(
      "[pkg:check] npm publish manifest must include only dist/npm-launcher.mjs, LICENSE, and README.md.",
    );
  }
  if (manifest.license !== "MIT") {
    throw new Error("[pkg:check] npm publish manifest license must be MIT.");
  }
  if (manifest.publishConfig?.access !== "public") {
    throw new Error("[pkg:check] npm publish manifest access must be public.");
  }
  if (manifest.publishConfig.provenance !== true) {
    throw new Error("[pkg:check] npm publish manifest must enable provenance.");
  }

  const expectedOptionalDependencies = Object.fromEntries(
    RELEASE_BINARY_TARGETS.map((target) => [`@kitsunekode/kunai-${target.id}`, expectedVersion]),
  );
  const actualEntries = Object.entries(manifest.optionalDependencies ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const expectedEntries = Object.entries(expectedOptionalDependencies).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      "[pkg:check] npm publish manifest optional dependencies must exactly cover every platform package at the launcher version.",
    );
  }
}

type RawTarMember = {
  readonly archivePath: string;
  readonly size: number;
};

export type NpmPackSummary = {
  readonly paths: string[];
  readonly packedBytes: number;
  readonly unpackedBytes: number;
};

function readTarString(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const nullOffset = field.indexOf(0);
  return textDecoder.decode(field.subarray(0, nullOffset === -1 ? field.length : nullOffset));
}

function readTarOctal(
  header: Uint8Array,
  offset: number,
  length: number,
  fieldName: string,
): number {
  const raw = readTarString(header, offset, length).trim();
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error(`[pkg:check] preserved npm tarball has an invalid ${fieldName} field.`);
  }
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`[pkg:check] preserved npm tarball has an unsafe ${fieldName} field.`);
  }
  return value;
}

function assertTarHeaderChecksum(header: Uint8Array): void {
  const expected = readTarOctal(header, TAR_CHECKSUM_OFFSET, TAR_CHECKSUM_BYTES, "header checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    const inChecksumField =
      index >= TAR_CHECKSUM_OFFSET && index < TAR_CHECKSUM_OFFSET + TAR_CHECKSUM_BYTES;
    actual += inChecksumField ? TAR_SPACE : (header[index] ?? 0);
  }
  if (actual !== expected) {
    throw new Error("[pkg:check] preserved npm tarball has an invalid header checksum.");
  }
}

function isZeroTarBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

function rawTarMembers(compressedBytes: Uint8Array): readonly RawTarMember[] {
  const bytes = gunzipSync(compressedBytes, { maxOutputLength: TAR_CONTAINER_BUDGET_BYTES });
  if (bytes.length === 0 || bytes.length % TAR_BLOCK_BYTES !== 0) {
    throw new Error("[pkg:check] preserved npm tarball has an invalid block-aligned payload.");
  }

  const members: RawTarMember[] = [];
  const paths = new Set<string>();
  for (let offset = 0; offset < bytes.length;) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroTarBlock(header)) {
      const secondBlock = bytes.subarray(offset + TAR_BLOCK_BYTES, offset + TAR_BLOCK_BYTES * 2);
      const trailingBytes = bytes.subarray(offset + TAR_BLOCK_BYTES * 2);
      if (secondBlock.length !== TAR_BLOCK_BYTES || !isZeroTarBlock(secondBlock)) {
        throw new Error("[pkg:check] preserved npm tarball has an incomplete end marker.");
      }
      if (!trailingBytes.every((byte) => byte === 0)) {
        throw new Error("[pkg:check] preserved npm tarball has data after its end marker.");
      }
      return members;
    }

    assertTarHeaderChecksum(header);
    const name = readTarString(header, TAR_NAME_OFFSET, TAR_NAME_BYTES);
    const prefix = readTarString(header, TAR_PREFIX_OFFSET, TAR_PREFIX_BYTES);
    const archivePath = prefix.length > 0 ? `${prefix}/${name}` : name;
    if (archivePath.length === 0) {
      throw new Error("[pkg:check] preserved npm tarball has an empty member path.");
    }
    if (paths.has(archivePath)) {
      throw new Error(
        `[pkg:check] preserved npm tarball has a duplicate archive member: ${archivePath}`,
      );
    }
    paths.add(archivePath);

    const type = header[TAR_TYPE_OFFSET] ?? 0;
    if (type !== 0 && type !== TAR_REGULAR_FILE) {
      throw new Error(
        `[pkg:check] preserved npm tarball member must be a regular file: ${archivePath}`,
      );
    }
    const size = readTarOctal(header, TAR_SIZE_OFFSET, TAR_SIZE_BYTES, "member size");
    const dataBlocks = Math.ceil(size / TAR_BLOCK_BYTES);
    const nextOffset = offset + TAR_BLOCK_BYTES + dataBlocks * TAR_BLOCK_BYTES;
    if (nextOffset > bytes.length) {
      throw new Error(
        `[pkg:check] preserved npm tarball member exceeds the archive payload: ${archivePath}`,
      );
    }
    members.push({ archivePath, size });
    offset = nextOffset;
  }

  throw new Error("[pkg:check] preserved npm tarball has no complete end marker.");
}

/** Verify file and manifest policy against the exact bytes later uploaded and published. */
export async function verifyPreservedNpmTarball(
  tarballPath: string,
  expectedVersion: string,
): Promise<NpmPackSummary> {
  let packedBytes: number;
  let compressedBytes: Uint8Array;
  try {
    const metadata = statSync(tarballPath);
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error("candidate is not a nonempty file");
    }
    compressedBytes = readFileSync(tarballPath);
    packedBytes = compressedBytes.byteLength;
    if (packedBytes !== metadata.size) {
      throw new Error("candidate changed while it was being read");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[pkg:check] preserved npm tarball is unavailable: ${tarballPath}: ${message}`,
      {
        cause: error,
      },
    );
  }

  if (packedBytes > NPM_PACK_PACKED_BUDGET_BYTES) {
    assertNpmPackBudgets(packedBytes, 0);
  }

  let members: readonly RawTarMember[];
  let archiveFiles: Awaited<ReturnType<Bun.Archive["files"]>>;
  try {
    members = rawTarMembers(compressedBytes);
    archiveFiles = await new Bun.Archive(compressedBytes).files();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[pkg:check] preserved npm tarball could not be read: ${message}`, {
      cause: error,
    });
  }

  const paths: string[] = [];
  let unpackedBytes = 0;
  for (const { archivePath, size } of members) {
    if (!archivePath.startsWith("package/")) {
      throw new Error(
        `[pkg:check] preserved npm tarball path must be rooted under package/: ${archivePath}`,
      );
    }
    const path = archivePath.slice("package/".length);
    const segments = path.split("/");
    if (
      path.length === 0 ||
      path.includes("\\") ||
      segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
      throw new Error(`[pkg:check] preserved npm tarball has an unsafe path: ${archivePath}`);
    }
    paths.push(path);
    unpackedBytes += size;
    const extractedFile = archiveFiles.get(archivePath);
    if (!extractedFile || extractedFile.size !== size) {
      throw new Error(
        `[pkg:check] preserved npm tarball member could not be extracted exactly: ${archivePath}`,
      );
    }
  }
  if (archiveFiles.size !== members.length) {
    throw new Error("[pkg:check] preserved npm tarball extraction changed its member set.");
  }
  paths.sort();
  assertNpmPackContents(paths);
  assertNpmPackBudgets(packedBytes, unpackedBytes);

  const manifestFile = archiveFiles.get("package/package.json");
  if (!manifestFile) {
    throw new Error("[pkg:check] preserved npm tarball is missing package/package.json.");
  }
  let manifest: NpmPublishManifest;
  try {
    manifest = parseManifestJson(
      await manifestFile.text(),
      "preserved npm tarball package/package.json",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[pkg:check] preserved npm tarball has invalid package.json: ${message}`, {
      cause: error,
    });
  }
  assertNpmPublishManifest(manifest, expectedVersion);
  return { paths, packedBytes, unpackedBytes };
}

function parseManifestJson(raw: string, context: string): NpmPublishManifest {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || Array.isArray(parsed) || Object(parsed) !== parsed) {
    throw new Error(`[pkg:check] ${context} must be a JSON object.`);
  }
  // SAFETY: the object boundary is established above; every optional field
  // consumed from this shape is validated by assertNpmPublishManifest.
  return parsed as NpmPublishManifest;
}

type VerifyNpmPackArgs =
  | { readonly mode: "dry-run" }
  | { readonly mode: "tarball"; readonly path: string; readonly expectedVersion: string };

export function buildNpmPackCommand({
  args,
  npmPath,
  nodePath,
  npmCliPath,
}: {
  readonly args: readonly string[];
  readonly npmPath: string | null;
  readonly nodePath: string | null;
  readonly npmCliPath: string | null;
}): string[] {
  if (nodePath && npmCliPath) return [nodePath, npmCliPath, ...args];
  return [npmPath ?? "npm", ...args];
}

function resolveNpmCliPath(npmPath: string | null): string | null {
  if (!npmPath) return null;
  if (process.platform === "win32") {
    const candidate = join(dirname(npmPath), "node_modules", "npm", "bin", "npm-cli.js");
    return existsSync(candidate) ? candidate : null;
  }
  try {
    const resolved = realpathSync(npmPath);
    return resolved.endsWith("npm-cli.js") && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function parseArgs(args: readonly string[], sourceVersion: string): VerifyNpmPackArgs {
  if (args.length === 0) return { mode: "dry-run" };
  let path: string | undefined;
  let expectedVersion = sourceVersion;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--tarball" && args[index + 1]) {
      path = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--expected-version" && args[index + 1]) {
      expectedVersion = args[index + 1] ?? sourceVersion;
      index += 1;
      continue;
    }
    throw new Error(`[pkg:check] unknown or incomplete argument: ${argument}`);
  }
  if (!path) throw new Error("[pkg:check] --tarball PATH is required for artifact verification.");
  return { mode: "tarball", path, expectedVersion };
}

async function main(): Promise<void> {
  const sourceManifest = parseManifestJson(
    readFileSync(join(ROOT, "package.json"), "utf8"),
    "source package manifest",
  );
  if (!sourceManifest.version) {
    throw new Error("[pkg:check] source package manifest has no version.");
  }
  const parsedArgs = parseArgs(process.argv.slice(2), sourceManifest.version);
  if (parsedArgs.mode === "tarball") {
    const summary = await verifyPreservedNpmTarball(parsedArgs.path, parsedArgs.expectedVersion);
    console.log(
      `[pkg:check] exact tarball ok — ${summary.paths.length} files, packed ${formatBuildSize(summary.packedBytes)} / ${formatBuildSize(NPM_PACK_PACKED_BUDGET_BYTES)}, unpacked ${formatBuildSize(summary.unpackedBytes)} / ${formatBuildSize(NPM_PACK_UNPACKED_BUDGET_BYTES)}`,
    );
    return;
  }

  const packDirectory = mkdtempSync(join(tmpdir(), "kunai-npm-pack-output-"));
  const cacheDirectory = mkdtempSync(join(tmpdir(), "kunai-npm-pack-cache-"));
  const args = ["pack", "--ignore-scripts", "--pack-destination", packDirectory];
  const npmPath = Bun.which("npm");
  const command = buildNpmPackCommand({
    args,
    npmPath,
    nodePath: Bun.which("node"),
    npmCliPath: resolveNpmCliPath(npmPath),
  });

  const result = (() => {
    try {
      return Bun.spawnSync(command, {
        cwd: NPM_PUBLISH_ROOT,
        stdout: "ignore",
        stderr: "inherit",
        env: {
          ...process.env,
          // Keep verification hermetic: npm otherwise writes to the user's cache,
          // which is unavailable in sandboxes and unnecessary for a dry pack.
          npm_config_cache: cacheDirectory,
        },
      });
    } finally {
      rmSync(cacheDirectory, { recursive: true, force: true });
    }
  })();
  if (result.exitCode !== 0) {
    rmSync(packDirectory, { recursive: true, force: true });
    process.exit(result.exitCode ?? 1);
  }

  const manifest = parseManifestJson(
    readFileSync(join(NPM_PUBLISH_ROOT, "package.json"), "utf8"),
    "generated npm publish manifest",
  );
  assertNpmPublishManifest(manifest, sourceManifest.version);
  try {
    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith(".tgz"));
    if (tarballs.length !== 1 || !tarballs[0]) {
      throw new Error(
        `[pkg:check] npm pack must produce exactly one tarball, received ${tarballs.length}.`,
      );
    }
    const summary = await verifyPreservedNpmTarball(
      join(packDirectory, tarballs[0]),
      sourceManifest.version,
    );
    console.log(
      `[pkg:check] ok — ${summary.paths.length} files, packed ${formatBuildSize(summary.packedBytes)} / ${formatBuildSize(NPM_PACK_PACKED_BUDGET_BYTES)}, unpacked ${formatBuildSize(summary.unpackedBytes)} / ${formatBuildSize(NPM_PACK_UNPACKED_BUDGET_BYTES)}`,
    );
  } finally {
    rmSync(packDirectory, { recursive: true, force: true });
  }
}

if (import.meta.path === Bun.main) {
  await main();
}
