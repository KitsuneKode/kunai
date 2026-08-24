import { gunzipSync, inflateRawSync } from "node:zlib";

import type { ReleaseBinaryTarget } from "../platform-assets";

const TAR_BLOCK_BYTES = 512;
const TAR_TRAILER_BYTES = TAR_BLOCK_BYTES * 2;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_END_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_UTF8 = 0x0800;

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeNullTerminated(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    end === -1 ? bytes : bytes.subarray(0, end),
  );
}

function assertExpectedEntryName(name: string, target: ReleaseBinaryTarget): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(`Archive contains unsafe traversal entry: ${JSON.stringify(name)}`);
  }
  if (name !== target.archiveEntryName) {
    throw new Error(
      `Archive contains unexpected entry ${JSON.stringify(name)}; expected ${target.archiveEntryName}`,
    );
  }
}

function parseTarOctal(field: Uint8Array, label: string): number {
  const text = decodeNullTerminated(field).trim();
  if (!/^[0-7]+$/.test(text)) throw new Error(`Invalid tar ${label}`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid tar ${label}`);
  return value;
}

function isZeroBlock(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function extractTarGz(archive: Uint8Array, target: ReleaseBinaryTarget): Uint8Array {
  const paddedBudget = Math.ceil(target.maxBinaryBytes / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  const outputBudget = TAR_BLOCK_BYTES + paddedBudget + TAR_TRAILER_BYTES;
  let tar: Uint8Array;
  try {
    tar = new Uint8Array(gunzipSync(archive, { maxOutputLength: outputBudget }));
  } catch (error) {
    throw new Error(`Archive decompression exceeded the binary output budget or is invalid`, {
      cause: error,
    });
  }
  if (tar.length < TAR_BLOCK_BYTES + TAR_TRAILER_BYTES || tar.length % TAR_BLOCK_BYTES !== 0) {
    throw new Error("Invalid tar container size");
  }

  let offset = 0;
  let extracted: Uint8Array | undefined;
  let sawTrailer = false;
  while (offset + TAR_BLOCK_BYTES <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) {
      const second = tar.subarray(offset + TAR_BLOCK_BYTES, offset + TAR_TRAILER_BYTES);
      if (second.length !== TAR_BLOCK_BYTES || !isZeroBlock(second)) {
        throw new Error("Tar archive is missing its two-block trailer");
      }
      if (!isZeroBlock(tar.subarray(offset + TAR_TRAILER_BYTES))) {
        throw new Error("Tar archive contains data after its trailer");
      }
      sawTrailer = true;
      break;
    }
    if (extracted) throw new Error("Release archive must contain exactly one regular file");

    const storedChecksum = parseTarOctal(header.subarray(148, 156), "header checksum");
    const checksumHeader = new Uint8Array(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (storedChecksum !== actualChecksum) throw new Error("Invalid tar header checksum");

    const name = decodeNullTerminated(header.subarray(0, 100));
    if (!isZeroBlock(header.subarray(345, 500))) {
      throw new Error("Tar path prefixes are forbidden");
    }
    assertExpectedEntryName(name, target);
    const type = header[156];
    if (type !== 0 && type !== 0x30) {
      throw new Error("Release archive entry must be a regular file; links are forbidden");
    }
    const size = parseTarOctal(header.subarray(124, 136), "entry size");
    if (size <= 0 || size > target.maxBinaryBytes) {
      throw new Error(
        `Extracted binary size ${size} exceeds the ${target.maxBinaryBytes} byte budget`,
      );
    }
    const bodyStart = offset + TAR_BLOCK_BYTES;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) throw new Error("Tar entry is truncated");
    extracted = tar.slice(bodyStart, bodyEnd);
    offset = bodyStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }

  if (!sawTrailer) throw new Error("Tar archive is missing its two-block trailer");
  if (!extracted) throw new Error("Release archive must contain exactly one regular file");
  return extracted;
}

function findZipEnd(archive: Uint8Array): number {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const minimum = Math.max(0, archive.length - ZIP_END_MIN_BYTES - ZIP_MAX_COMMENT_BYTES);
  for (let offset = archive.length - ZIP_END_MIN_BYTES; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) return offset;
  }
  throw new Error("Zip archive is missing its end record");
}

function extractZip(archive: Uint8Array, target: ReleaseBinaryTarget): Uint8Array {
  if (archive.length < ZIP_END_MIN_BYTES) throw new Error("Zip archive is truncated");
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = findZipEnd(archive);
  const commentLength = view.getUint16(end + 20, true);
  if (end + ZIP_END_MIN_BYTES + commentLength !== archive.length) {
    throw new Error("Zip archive contains trailing data");
  }
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw new Error("Multi-disk zip archives are not supported");
  }
  const diskEntries = view.getUint16(end + 8, true);
  const totalEntries = view.getUint16(end + 10, true);
  if (diskEntries !== 1 || totalEntries !== 1) {
    throw new Error("Release archive must contain exactly one regular file");
  }
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (centralOffset + centralSize !== end || centralOffset < 30) {
    throw new Error("Invalid zip central directory bounds");
  }
  if (view.getUint32(centralOffset, true) !== ZIP_CENTRAL_SIGNATURE) {
    throw new Error("Invalid zip central directory");
  }

  const flags = view.getUint16(centralOffset + 8, true);
  if ((flags & (ZIP_FLAG_ENCRYPTED | ZIP_FLAG_DATA_DESCRIPTOR)) !== 0) {
    throw new Error("Encrypted or data-descriptor zip entries are forbidden");
  }
  if ((flags & ~ZIP_FLAG_UTF8) !== 0) throw new Error("Unsupported zip entry flags");
  const method = view.getUint16(centralOffset + 10, true);
  if (method !== 0 && method !== 8) throw new Error(`Unsupported zip compression method ${method}`);
  const expectedCrc = view.getUint32(centralOffset + 16, true);
  const compressedSize = view.getUint32(centralOffset + 20, true);
  const binarySize = view.getUint32(centralOffset + 24, true);
  if (binarySize <= 0 || binarySize > target.maxBinaryBytes) {
    throw new Error(
      `Extracted binary size ${binarySize} exceeds the ${target.maxBinaryBytes} byte budget`,
    );
  }
  const centralNameLength = view.getUint16(centralOffset + 28, true);
  const centralExtraLength = view.getUint16(centralOffset + 30, true);
  const centralCommentLength = view.getUint16(centralOffset + 32, true);
  if (centralOffset + 46 + centralNameLength + centralExtraLength + centralCommentLength !== end) {
    throw new Error("Zip central directory contains unexpected records");
  }
  const centralName = new TextDecoder("utf-8", { fatal: true }).decode(
    archive.subarray(centralOffset + 46, centralOffset + 46 + centralNameLength),
  );
  assertExpectedEntryName(centralName, target);
  const externalAttributes = view.getUint32(centralOffset + 38, true);
  const unixType = (externalAttributes >>> 16) & 0o170000;
  if (unixType !== 0 && unixType !== 0o100000) {
    throw new Error("Release archive entry must be a regular file; symlinks are forbidden");
  }
  if ((externalAttributes & 0x10) !== 0) throw new Error("Zip directory entries are forbidden");

  const localOffset = view.getUint32(centralOffset + 42, true);
  if (localOffset !== 0 || view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
    throw new Error("Zip archive contains an unsafe prefix or invalid local entry");
  }
  const localFlags = view.getUint16(localOffset + 6, true);
  const localMethod = view.getUint16(localOffset + 8, true);
  const localCrc = view.getUint32(localOffset + 14, true);
  const localCompressedSize = view.getUint32(localOffset + 18, true);
  const localBinarySize = view.getUint32(localOffset + 22, true);
  const localNameLength = view.getUint16(localOffset + 26, true);
  const localExtraLength = view.getUint16(localOffset + 28, true);
  if (
    localFlags !== flags ||
    localMethod !== method ||
    localCrc !== expectedCrc ||
    localCompressedSize !== compressedSize ||
    localBinarySize !== binarySize
  ) {
    throw new Error("Zip local entry does not match its central record");
  }
  const localName = new TextDecoder("utf-8", { fatal: true }).decode(
    archive.subarray(localOffset + 30, localOffset + 30 + localNameLength),
  );
  if (localName !== centralName) throw new Error("Zip entry names do not match");
  const bodyStart = localOffset + 30 + localNameLength + localExtraLength;
  const bodyEnd = bodyStart + compressedSize;
  if (bodyEnd !== centralOffset) throw new Error("Zip archive contains unexpected local records");

  const compressed = archive.subarray(bodyStart, bodyEnd);
  let binary: Uint8Array;
  try {
    binary =
      method === 0
        ? new Uint8Array(compressed)
        : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: target.maxBinaryBytes }));
  } catch (error) {
    throw new Error("Zip decompression exceeded the binary output budget or is invalid", {
      cause: error,
    });
  }
  if (binary.length !== binarySize) throw new Error("Zip entry decompressed size mismatch");
  if (crc32(binary) !== expectedCrc) throw new Error("Zip entry CRC mismatch");
  return binary;
}

/**
 * Parse a release archive in-process and return its only verified regular-file
 * member. No platform extractor is invoked, so archive names never become argv.
 */
export function extractReleaseArchive(
  archive: Uint8Array,
  target: ReleaseBinaryTarget,
): Uint8Array {
  if (archive.length <= 0 || archive.length > target.maxArchiveBytes) {
    throw new Error(
      `Release archive size ${archive.length} exceeds the ${target.maxArchiveBytes} byte budget`,
    );
  }
  return target.archiveFormat === "zip"
    ? extractZip(archive, target)
    : extractTarGz(archive, target);
}
