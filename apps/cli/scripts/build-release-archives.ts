#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

import {
  RELEASE_BINARY_TARGETS,
  type ReleaseBinaryTarget,
} from "../src/services/update/platform-assets";

const DEFAULT_DIRECTORY = join(import.meta.dirname, "../dist/bin");
const encoder = new TextEncoder();
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return crc >>> 0;
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeAscii(buffer: Uint8Array, offset: number, value: string): void {
  buffer.set(encoder.encode(value), offset);
}

function writeTarOctal(buffer: Uint8Array, offset: number, length: number, value: number): void {
  const octal = value.toString(8);
  if (octal.length > length - 1) {
    throw new Error(`[archives] tar value ${value} exceeds ${length}-byte field`);
  }
  writeAscii(buffer, offset, `${octal.padStart(length - 1, "0")}\0`);
}

function deterministicTar(entryName: string, mode: number, body: Uint8Array): Uint8Array {
  const nameBytes = encoder.encode(entryName);
  if (nameBytes.length === 0 || nameBytes.length > 100 || /[\\/]/.test(entryName)) {
    throw new Error(`[archives] unsafe tar entry name: ${entryName}`);
  }

  const paddedBodyBytes = Math.ceil(body.length / 512) * 512;
  const tar = new Uint8Array(512 + paddedBodyBytes + 1_024);
  const header = tar.subarray(0, 512);
  header.set(nameBytes, 0);
  writeTarOctal(header, 100, 8, mode);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, body.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeAscii(header, 257, "ustar\0");
  writeAscii(header, 263, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeAscii(header, 148, `${checksum.toString(8).padStart(6, "0")}\0 `);
  tar.set(body, 512);
  return tar;
}

function deterministicGzip(body: Uint8Array): Uint8Array {
  const compressed = deflateRawSync(body, { level: 9 });
  const output = new Uint8Array(10 + compressed.length + 8);
  output.set([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff], 0);
  output.set(compressed, 10);
  const footer = new DataView(output.buffer, output.byteOffset + 10 + compressed.length, 8);
  footer.setUint32(0, crc32(body), true);
  footer.setUint32(4, body.length >>> 0, true);
  return output;
}

function deterministicZip(entryName: string, mode: number, body: Uint8Array): Uint8Array {
  const name = encoder.encode(entryName);
  if (name.length === 0 || name.length > 0xffff || /[\\/]/.test(entryName)) {
    throw new Error(`[archives] unsafe zip entry name: ${entryName}`);
  }
  const compressed = deflateRawSync(body, { level: 9 });
  const localSize = 30 + name.length + compressed.length;
  const centralSize = 46 + name.length;
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const digest = crc32(body);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 8, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0x21, true);
  view.setUint32(14, digest, true);
  view.setUint32(18, compressed.length, true);
  view.setUint32(22, body.length, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  output.set(name, 30);
  output.set(compressed, 30 + name.length);

  const central = localSize;
  view.setUint32(central, 0x02014b50, true);
  view.setUint16(central + 4, 0x0314, true);
  view.setUint16(central + 6, 20, true);
  view.setUint16(central + 8, 0x0800, true);
  view.setUint16(central + 10, 8, true);
  view.setUint16(central + 12, 0, true);
  view.setUint16(central + 14, 0x21, true);
  view.setUint32(central + 16, digest, true);
  view.setUint32(central + 20, compressed.length, true);
  view.setUint32(central + 24, body.length, true);
  view.setUint16(central + 28, name.length, true);
  view.setUint16(central + 30, 0, true);
  view.setUint16(central + 32, 0, true);
  view.setUint16(central + 34, 0, true);
  view.setUint16(central + 36, 0, true);
  view.setUint32(central + 38, ((0o100000 | mode) << 16) >>> 0, true);
  view.setUint32(central + 42, 0, true);
  output.set(name, central + 46);

  const end = central + centralSize;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 4, 0, true);
  view.setUint16(end + 6, 0, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, centralSize, true);
  view.setUint32(end + 16, central, true);
  view.setUint16(end + 20, 0, true);
  return output;
}

export function createReleaseArchive(target: ReleaseBinaryTarget, binary: Uint8Array): Uint8Array {
  if (target.archiveFormat === "zip") {
    return deterministicZip(target.archiveEntryName, target.archiveMode, binary);
  }
  return deterministicGzip(deterministicTar(target.archiveEntryName, target.archiveMode, binary));
}

function checksumManifest(directory: string, names: readonly string[]): string {
  return `${[...names]
    .sort()
    .map((name) => `${sha256(readFileSync(join(directory, name)))}  ${name}`)
    .join("\n")}\n`;
}

function validateRawInputs(directory: string, targets: readonly ReleaseBinaryTarget[]): void {
  for (const target of targets) {
    const path = join(directory, target.out);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      throw new Error(`[archives] missing raw release binary: ${target.out}`);
    }
    if (!stat.isFile()) {
      throw new Error(`[archives] raw release binary is not a file: ${target.out}`);
    }
    if (stat.size <= 0) {
      throw new Error(`[archives] raw release binary is empty: ${target.out}`);
    }
    if (stat.size > target.maxBinaryBytes) {
      throw new Error(
        `[archives] size budget exceeded for ${target.out}: ${stat.size} > ${target.maxBinaryBytes}`,
      );
    }
  }
}

function retainedReleaseTargets(
  directory: string,
  requestedTargets: readonly ReleaseBinaryTarget[],
): readonly ReleaseBinaryTarget[] {
  validateRawInputs(directory, requestedTargets);

  const retained = RELEASE_BINARY_TARGETS.filter((target) =>
    existsSync(join(directory, target.out)),
  );
  validateRawInputs(directory, retained);

  const knownArchiveNames = new Set(RELEASE_BINARY_TARGETS.map((target) => target.archiveName));
  for (const name of readdirSync(directory)) {
    if ((name.endsWith(".tar.gz") || name.endsWith(".zip")) && !knownArchiveNames.has(name)) {
      throw new Error(`[archives] unexpected stale release archive: ${name}`);
    }
  }

  const retainedArchiveNames = new Set(retained.map((target) => target.archiveName));
  for (const target of RELEASE_BINARY_TARGETS) {
    if (!retainedArchiveNames.has(target.archiveName)) {
      rmSync(join(directory, target.archiveName), { force: true });
    }
  }

  return retained;
}

export function verifyBuiltReleaseArchives(
  directory: string,
  targets: readonly ReleaseBinaryTarget[] = RELEASE_BINARY_TARGETS,
): void {
  validateRawInputs(directory, targets);
  for (const target of targets) {
    const binary = readFileSync(join(directory, target.out));
    const archivePath = join(directory, target.archiveName);
    let archive: Uint8Array;
    try {
      archive = readFileSync(archivePath);
    } catch {
      throw new Error(`[archives] missing release archive: ${target.archiveName}`);
    }
    if (archive.length <= 0 || archive.length > target.maxArchiveBytes) {
      throw new Error(
        `[archives] size budget failed for ${target.archiveName}: ${archive.length} (max ${target.maxArchiveBytes})`,
      );
    }
    const canonical = createReleaseArchive(target, binary);
    if (!Buffer.from(archive).equals(Buffer.from(canonical))) {
      throw new Error(
        `[archives] ${target.archiveName} is not the canonical one-member archive for ${target.out}`,
      );
    }
  }

  const expectedArchives = checksumManifest(
    directory,
    targets.map((target) => target.archiveName),
  );
  const expectedRaw = checksumManifest(
    directory,
    targets.map((target) => target.out),
  );
  if (readFileSync(join(directory, "SHA256SUMS.archives"), "utf8") !== expectedArchives) {
    throw new Error("[archives] SHA256SUMS.archives must contain exact sorted archive hashes");
  }
  if (readFileSync(join(directory, "SHA256SUMS"), "utf8") !== expectedRaw) {
    throw new Error("[archives] SHA256SUMS must contain exact sorted raw binary hashes");
  }
}

export function buildReleaseArchives(
  directory: string,
  targets: readonly ReleaseBinaryTarget[] = RELEASE_BINARY_TARGETS,
): readonly ReleaseBinaryTarget[] {
  mkdirSync(directory, { recursive: true });
  const retainedTargets = retainedReleaseTargets(directory, targets);

  const tempPaths: string[] = [];
  try {
    for (const target of retainedTargets) {
      const archive = createReleaseArchive(target, readFileSync(join(directory, target.out)));
      if (archive.length <= 0 || archive.length > target.maxArchiveBytes) {
        throw new Error(
          `[archives] size budget failed for ${target.archiveName}: ${archive.length} (max ${target.maxArchiveBytes})`,
        );
      }
      const tempPath = join(directory, `.${target.archiveName}.tmp`);
      writeFileSync(tempPath, archive);
      tempPaths.push(tempPath);
    }

    for (const [index, target] of retainedTargets.entries()) {
      const tempPath = tempPaths[index];
      if (!tempPath) throw new Error(`[archives] missing staged archive for ${target.archiveName}`);
      const destination = join(directory, target.archiveName);
      rmSync(destination, { force: true });
      renameSync(tempPath, destination);
    }
    tempPaths.length = 0;

    writeFileSync(
      join(directory, "SHA256SUMS.archives"),
      checksumManifest(
        directory,
        retainedTargets.map((target) => target.archiveName),
      ),
    );
    writeFileSync(
      join(directory, "SHA256SUMS"),
      checksumManifest(
        directory,
        retainedTargets.map((target) => target.out),
      ),
    );
    verifyBuiltReleaseArchives(directory, retainedTargets);
  } finally {
    for (const path of tempPaths) rmSync(path, { force: true });
  }
  return retainedTargets;
}

function parseDirectory(argv: readonly string[]): string {
  let directory = DEFAULT_DIRECTORY;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === "--directory") {
      const value = argv[++index];
      if (!value) throw new Error("[archives] --directory requires a path");
      directory = resolve(value);
      continue;
    }
    throw new Error(`[archives] unknown option: ${argument}`);
  }
  return directory;
}

if (import.meta.main) {
  try {
    const directory = parseDirectory(process.argv.slice(2));
    const retainedTargets = buildReleaseArchives(directory);
    console.log(
      `[archives] wrote and verified ${retainedTargets.length} archives + SHA256SUMS + SHA256SUMS.archives in ${directory}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
