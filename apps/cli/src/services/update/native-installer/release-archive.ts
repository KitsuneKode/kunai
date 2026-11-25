import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import {
  createGunzip,
  createZstdDecompress,
  gunzipSync,
  inflateRawSync,
  zstdDecompressSync,
} from "node:zlib";

import {
  releaseArchiveFormatOf,
  type ReleaseArchiveFormat,
  type ReleaseBinaryTarget,
} from "../platform-assets";

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

/** A rejection by the archive's own rules, as opposed to a decoder failure. */
export class ReleaseArchiveError extends Error {}

const DECOMPRESSION_FAILED =
  "Archive decompression exceeded the binary output budget or is invalid";

/** Decompressed bytes a canonical one-member tar of `target` can occupy. */
function tarOutputBudget(target: ReleaseBinaryTarget): number {
  const paddedBudget = Math.ceil(target.maxBinaryBytes / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  return TAR_BLOCK_BYTES + paddedBudget + TAR_TRAILER_BYTES;
}

type TarReaderState = "header" | "body" | "padding" | "trailer";

/**
 * Strict reader for the release tar shape: exactly one regular file named
 * `target.archiveEntryName`, then a zero trailer of at least two blocks and
 * nothing else. It takes the decompressed tar in chunks of any size, so the
 * updater can stream a 120 MB binary to disk; the buffered path feeds it once.
 */
class SingleMemberTarReader {
  private readonly header = new Uint8Array(TAR_BLOCK_BYTES);
  private headerFill = 0;
  private state: TarReaderState = "header";
  private remaining = 0;
  private entrySize = 0;
  private trailerBytes = 0;
  private total = 0;
  private readonly budget: number;

  constructor(private readonly target: ReleaseBinaryTarget) {
    this.budget = tarOutputBudget(target);
  }

  /** Consume one chunk; returns the member-body slices it contained, in order. */
  push(chunk: Uint8Array): Uint8Array[] {
    this.total += chunk.length;
    if (this.total > this.budget) throw new ReleaseArchiveError(DECOMPRESSION_FAILED);
    const body: Uint8Array[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const available = chunk.length - offset;
      if (this.state === "header") {
        const take = Math.min(TAR_BLOCK_BYTES - this.headerFill, available);
        this.header.set(chunk.subarray(offset, offset + take), this.headerFill);
        this.headerFill += take;
        offset += take;
        if (this.headerFill === TAR_BLOCK_BYTES) this.acceptHeader();
      } else if (this.state === "body") {
        const take = Math.min(this.remaining, available);
        body.push(chunk.subarray(offset, offset + take));
        this.remaining -= take;
        offset += take;
        if (this.remaining === 0) this.enterPadding();
      } else if (this.state === "padding") {
        const take = Math.min(this.remaining, available);
        this.remaining -= take;
        offset += take;
        if (this.remaining === 0) this.state = "trailer";
      } else {
        this.checkTrailer(chunk.subarray(offset));
        offset = chunk.length;
      }
    }
    return body;
  }

  /** Assert the tar ended where a canonical archive ends. */
  finish(): void {
    if (this.state === "body") throw new ReleaseArchiveError("Tar entry is truncated");
    if (this.state !== "trailer" || this.trailerBytes % TAR_BLOCK_BYTES !== 0) {
      throw new ReleaseArchiveError("Invalid tar container size");
    }
    if (this.trailerBytes < TAR_TRAILER_BYTES) {
      throw new ReleaseArchiveError("Tar archive is missing its two-block trailer");
    }
  }

  private acceptHeader(): void {
    const header = this.header;
    if (isZeroBlock(header)) {
      throw new ReleaseArchiveError("Release archive must contain exactly one regular file");
    }
    const storedChecksum = parseTarOctal(header.subarray(148, 156), "header checksum");
    const checksumHeader = new Uint8Array(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (storedChecksum !== actualChecksum) {
      throw new ReleaseArchiveError("Invalid tar header checksum");
    }

    const name = decodeNullTerminated(header.subarray(0, 100));
    if (!isZeroBlock(header.subarray(345, 500))) {
      throw new ReleaseArchiveError("Tar path prefixes are forbidden");
    }
    assertExpectedEntryName(name, this.target);
    const type = header[156];
    if (type !== 0 && type !== 0x30) {
      throw new ReleaseArchiveError(
        "Release archive entry must be a regular file; links are forbidden",
      );
    }
    const size = parseTarOctal(header.subarray(124, 136), "entry size");
    if (size <= 0 || size > this.target.maxBinaryBytes) {
      throw new ReleaseArchiveError(
        `Extracted binary size ${size} exceeds the ${this.target.maxBinaryBytes} byte budget`,
      );
    }
    this.state = "body";
    this.entrySize = size;
    this.remaining = size;
  }

  private enterPadding(): void {
    // The body's block is zero-padded to 512; the header itself is one block.
    const misalignment = this.entrySize % TAR_BLOCK_BYTES;
    this.remaining = misalignment === 0 ? 0 : TAR_BLOCK_BYTES - misalignment;
    this.state = this.remaining === 0 ? "trailer" : "padding";
  }

  private checkTrailer(bytes: Uint8Array): void {
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] === 0) continue;
      const position = this.trailerBytes + index;
      if (position < TAR_BLOCK_BYTES) {
        throw new ReleaseArchiveError("Release archive must contain exactly one regular file");
      }
      if (position < TAR_TRAILER_BYTES) {
        throw new ReleaseArchiveError("Tar archive is missing its two-block trailer");
      }
      throw new ReleaseArchiveError("Tar archive contains data after its trailer");
    }
    this.trailerBytes += bytes.length;
  }
}

function decompressTarSync(
  archive: Uint8Array,
  format: ReleaseArchiveFormat,
  budget: number,
): Uint8Array {
  try {
    return new Uint8Array(
      format === "tar.zst"
        ? zstdDecompressSync(archive, { maxOutputLength: budget })
        : gunzipSync(archive, { maxOutputLength: budget }),
    );
  } catch (error) {
    throw new ReleaseArchiveError(DECOMPRESSION_FAILED, { cause: error });
  }
}

function extractTarSync(
  archive: Uint8Array,
  format: ReleaseArchiveFormat,
  target: ReleaseBinaryTarget,
): Uint8Array {
  const reader = new SingleMemberTarReader(target);
  const pieces = reader.push(decompressTarSync(archive, format, tarOutputBudget(target)));
  reader.finish();
  if (pieces.length !== 1 || !pieces[0]) {
    throw new ReleaseArchiveError("Release archive must contain exactly one regular file");
  }
  return pieces[0].slice();
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

function assertArchiveSize(size: number, target: ReleaseBinaryTarget): void {
  if (size <= 0 || size > target.maxArchiveBytes) {
    throw new ReleaseArchiveError(
      `Release archive size ${size} exceeds the ${target.maxArchiveBytes} byte budget`,
    );
  }
}

/**
 * Parse a release archive in-process and return its only verified regular-file
 * member. No platform extractor is invoked, so archive names never become argv.
 * `format` defaults to the target's compatibility archive.
 */
export function extractReleaseArchive(
  archive: Uint8Array,
  target: ReleaseBinaryTarget,
  format: ReleaseArchiveFormat = target.archiveFormat,
): Uint8Array {
  assertArchiveSize(archive.length, target);
  return format === "zip" ? extractZip(archive, target) : extractTarSync(archive, format, target);
}

export type ExtractedReleaseBinary = {
  readonly sha256: string;
  readonly sizeBytes: number;
};

/**
 * Stream a checksum-verified archive at `archivePath` into `outputPath`,
 * hashing as it goes. A tar archive never sits in memory whole — the
 * decompressed tar for a 120 MB binary used to be buffered, then copied. Zip
 * (Windows) needs its central directory first, so it takes the buffered path.
 */
export async function extractReleaseArchiveFile(input: {
  readonly archivePath: string;
  readonly archiveName: string;
  readonly target: ReleaseBinaryTarget;
  readonly outputPath: string;
}): Promise<ExtractedReleaseBinary> {
  const { archivePath, target, outputPath } = input;
  const format = releaseArchiveFormatOf(input.archiveName);
  assertArchiveSize((await stat(archivePath)).size, target);

  if (format === "zip") {
    const binary = extractZip(new Uint8Array(await readFile(archivePath)), target);
    await writeFile(outputPath, binary);
    return { sha256: createHash("sha256").update(binary).digest("hex"), sizeBytes: binary.length };
  }

  const reader = new SingleMemberTarReader(target);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const output = await open(outputPath, "w");
  try {
    await pipeline(
      createReadStream(archivePath),
      format === "tar.zst" ? createZstdDecompress() : createGunzip(),
      async (source: AsyncIterable<Uint8Array>) => {
        for await (const chunk of source) {
          for (const piece of reader.push(chunk)) {
            hash.update(piece);
            sizeBytes += piece.length;
            await output.write(piece);
          }
        }
      },
    );
    reader.finish();
  } catch (error) {
    await output.close().catch(() => {});
    await rm(outputPath, { force: true }).catch(() => {});
    if (error instanceof ReleaseArchiveError) throw error;
    throw new ReleaseArchiveError(DECOMPRESSION_FAILED, { cause: error });
  }
  await output.close();
  return { sha256: hash.digest("hex"), sizeBytes };
}
