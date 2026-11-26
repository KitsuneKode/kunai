import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync, zstdCompressSync } from "node:zlib";

import {
  extractReleaseArchive,
  extractReleaseArchiveFile,
} from "@/services/update/native-installer/release-archive";
import {
  RELEASE_BINARY_TARGETS,
  type ReleaseBinaryTarget,
} from "@/services/update/platform-assets";

import {
  createReleaseArchive,
  createZstdReleaseArchive,
} from "../../../../../scripts/build-release-archives";

const encoder = new TextEncoder();

function target(id: string): ReleaseBinaryTarget {
  const found = RELEASE_BINARY_TARGETS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing fixture target ${id}`);
  return found;
}

function rewriteTarHeader(archive: Uint8Array, mutate: (header: Uint8Array) => void): Uint8Array {
  const tar = new Uint8Array(gunzipSync(archive));
  const header = tar.subarray(0, 512);
  mutate(header);
  header.fill(0x20, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.set(encoder.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
  return new Uint8Array(gzipSync(tar));
}

function duplicateTarMember(archive: Uint8Array, bodyLength: number): Uint8Array {
  const tar = new Uint8Array(gunzipSync(archive));
  const memberLength = 512 + Math.ceil(bodyLength / 512) * 512;
  const output = new Uint8Array(memberLength * 2 + 1_024);
  output.set(tar.subarray(0, memberLength), 0);
  output.set(tar.subarray(0, memberLength), memberLength);
  return new Uint8Array(gzipSync(output));
}

function rewriteZipNames(archive: Uint8Array, replacement: string): Uint8Array {
  const output = new Uint8Array(archive);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const localLength = view.getUint16(26, true);
  const bytes = encoder.encode(replacement.padEnd(localLength, "x").slice(0, localLength));
  output.set(bytes, 30);
  const compressedSize = view.getUint32(18, true);
  const centralOffset = 30 + localLength + compressedSize;
  output.set(bytes, centralOffset + 46);
  return output;
}

function zipCentralOffset(archive: Uint8Array): number {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  return 30 + view.getUint16(26, true) + view.getUint16(28, true) + view.getUint32(18, true);
}

describe("extractReleaseArchive", () => {
  for (const id of ["linux-x64", "darwin-arm64"] as const) {
    test(`extracts the canonical one-member ${id} tar.gz`, () => {
      const releaseTarget = target(id);
      const binary = encoder.encode(`binary-${id}`);
      const archive = createReleaseArchive(releaseTarget, binary);

      expect(extractReleaseArchive(archive, releaseTarget)).toEqual(binary);
    });
  }

  test("extracts the canonical one-member Windows zip", () => {
    const releaseTarget = target("windows-x64");
    const binary = encoder.encode("MZ-windows-binary");

    expect(
      extractReleaseArchive(createReleaseArchive(releaseTarget, binary), releaseTarget),
    ).toEqual(binary);
  });

  test("rejects traversal, unexpected, symlink, and multiple tar members", () => {
    const releaseTarget = target("linux-x64");
    const binary = encoder.encode("linux-binary");
    const archive = createReleaseArchive(releaseTarget, binary);

    const traversal = rewriteTarHeader(archive, (header) => {
      header.fill(0, 0, 100);
      header.set(encoder.encode("../kunai"), 0);
    });
    const unexpected = rewriteTarHeader(archive, (header) => {
      header.fill(0, 0, 100);
      header.set(encoder.encode("other-binary"), 0);
    });
    const symlink = rewriteTarHeader(archive, (header) => {
      header[156] = "2".charCodeAt(0);
    });
    const prefixedTraversal = rewriteTarHeader(archive, (header) => {
      header.set(encoder.encode("../escape"), 345);
    });

    expect(() => extractReleaseArchive(traversal, releaseTarget)).toThrow(/unsafe|traversal/i);
    expect(() => extractReleaseArchive(unexpected, releaseTarget)).toThrow(/unexpected/i);
    expect(() => extractReleaseArchive(symlink, releaseTarget)).toThrow(/regular file|symlink/i);
    expect(() => extractReleaseArchive(prefixedTraversal, releaseTarget)).toThrow(
      /prefix|unsafe|traversal/i,
    );
    expect(() =>
      extractReleaseArchive(duplicateTarMember(archive, binary.length), releaseTarget),
    ).toThrow(/exactly one|multiple/i);
  });

  test("rejects a tar member without the required two-block trailer", () => {
    const releaseTarget = target("linux-x64");
    const binary = new Uint8Array(1_024).fill(7);
    const tar = new Uint8Array(gunzipSync(createReleaseArchive(releaseTarget, binary)));
    const withoutTrailer = new Uint8Array(gzipSync(tar.subarray(0, 1_536)));

    expect(() => extractReleaseArchive(withoutTrailer, releaseTarget)).toThrow(/trailer/i);
  });

  test("rejects traversal, symlink, and multiple Windows zip members", () => {
    const releaseTarget = target("windows-x64");
    const binary = encoder.encode("MZ-windows-binary");
    const archive = createReleaseArchive(releaseTarget, binary);
    const symlink = new Uint8Array(archive);
    const symlinkView = new DataView(symlink.buffer, symlink.byteOffset, symlink.byteLength);
    const centralOffset = 30 + symlinkView.getUint16(26, true) + symlinkView.getUint32(18, true);
    symlinkView.setUint32(centralOffset + 38, (0o120777 << 16) >>> 0, true);
    const multiple = new Uint8Array(archive);
    const multipleView = new DataView(multiple.buffer, multiple.byteOffset, multiple.byteLength);
    multipleView.setUint16(multiple.length - 14, 2, true);
    multipleView.setUint16(multiple.length - 12, 2, true);

    expect(() => extractReleaseArchive(rewriteZipNames(archive, "../evil"), releaseTarget)).toThrow(
      /unsafe|traversal/i,
    );
    expect(() => extractReleaseArchive(symlink, releaseTarget)).toThrow(/regular file|symlink/i);
    expect(() => extractReleaseArchive(multiple, releaseTarget)).toThrow(/exactly one|multiple/i);
  });

  test("rejects a Windows zip whose payload CRC is corrupted", () => {
    const releaseTarget = target("windows-x64");
    const archive = createReleaseArchive(releaseTarget, encoder.encode("MZ-crc-binary"));
    const corrupted = new Uint8Array(archive);
    const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength);
    const centralOffset = zipCentralOffset(corrupted);
    const corruptedCrc = (view.getUint32(14, true) ^ 0xffff_ffff) >>> 0;
    view.setUint32(14, corruptedCrc, true);
    view.setUint32(centralOffset + 16, corruptedCrc, true);

    expect(() => extractReleaseArchive(corrupted, releaseTarget)).toThrow(/CRC/i);
  });

  test("rejects local and central Windows zip size disagreement", () => {
    const releaseTarget = target("windows-x64");
    const archive = createReleaseArchive(releaseTarget, encoder.encode("MZ-size-binary"));
    const mismatched = new Uint8Array(archive);
    const view = new DataView(mismatched.buffer, mismatched.byteOffset, mismatched.byteLength);
    view.setUint32(22, view.getUint32(22, true) + 1, true);

    expect(() => extractReleaseArchive(mismatched, releaseTarget)).toThrow(
      /local entry.*central record/i,
    );
  });

  test("rejects records trailing the Windows zip end record", () => {
    const releaseTarget = target("windows-x64");
    const archive = createReleaseArchive(releaseTarget, encoder.encode("MZ-trailing-binary"));
    const trailing = new Uint8Array(archive.length + 4);
    trailing.set(archive);
    trailing.set([0x50, 0x4b, 0x05, 0x06], archive.length);

    expect(() => extractReleaseArchive(trailing, releaseTarget)).toThrow(/trailing data/i);
  });

  test("enforces the Windows zip decompression output budget", () => {
    const releaseTarget = target("windows-x64");
    const archive = createReleaseArchive(releaseTarget, new Uint8Array(4_096).fill(7));
    const budgetMismatch = new Uint8Array(archive);
    const view = new DataView(
      budgetMismatch.buffer,
      budgetMismatch.byteOffset,
      budgetMismatch.byteLength,
    );
    const centralOffset = zipCentralOffset(budgetMismatch);
    view.setUint32(22, 4, true);
    view.setUint32(centralOffset + 24, 4, true);

    expect(() =>
      extractReleaseArchive(budgetMismatch, { ...releaseTarget, maxBinaryBytes: 4 }),
    ).toThrow(/decompression.*budget|output budget/i);
  });

  test("bounds archive bytes and decompressed output before allocation", () => {
    const releaseTarget = target("linux-x64");
    const tinyArchiveBudget = { ...releaseTarget, maxArchiveBytes: 8 };
    const tinyBinaryBudget = { ...releaseTarget, maxBinaryBytes: 4 };
    const archive = createReleaseArchive(releaseTarget, encoder.encode("larger-than-four"));

    expect(() => extractReleaseArchive(archive, tinyArchiveBudget)).toThrow(/archive.*size/i);
    expect(() => extractReleaseArchive(archive, tinyBinaryBudget)).toThrow(
      /decompression|binary.*size|output/i,
    );
  });
});

const scratch = mkdtempSync(join(tmpdir(), "kunai-release-archive-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function extractFile(
  name: string,
  archive: Uint8Array,
  releaseTarget: ReleaseBinaryTarget,
): Promise<{ readonly sha256: string; readonly sizeBytes: number; readonly output: string }> {
  const archivePath = join(scratch, `${crypto.randomUUID()}-${name}`);
  const output = `${archivePath}.bin`;
  writeFileSync(archivePath, archive);
  const result = await extractReleaseArchiveFile({
    archivePath,
    archiveName: name,
    target: releaseTarget,
    outputPath: output,
  });
  return { ...result, output };
}

describe("tar.zst release archives", () => {
  test("extracts the canonical one-member tar.zst, buffered", () => {
    const releaseTarget = target("linux-arm64-musl");
    const binary = encoder.encode("zstd-binary");
    const archive = createZstdReleaseArchive(releaseTarget, binary);

    expect(extractReleaseArchive(archive, releaseTarget, "tar.zst")).toEqual(binary);
  });

  test("windows targets publish no zstd archive", () => {
    expect(target("windows-x64").zstdArchiveName).toBeUndefined();
    expect(target("android-arm64").zstdArchiveName).toBe("kunai-android-arm64.tar.zst");
  });
});

describe("extractReleaseArchiveFile", () => {
  // Multi-block bodies with a ragged tail exercise every reader state across
  // the decoder's chunk boundaries — the streaming path's whole risk.
  const body = Uint8Array.from({ length: 300_001 }, (_, index) => (index * 31 + 7) % 251);

  for (const [label, build] of [
    ["tar.gz", createReleaseArchive],
    ["tar.zst", createZstdReleaseArchive],
  ] as const) {
    test(`streams a ${label} member to disk with its digest and size`, async () => {
      const releaseTarget = target("linux-x64");
      const result = await extractFile(
        `kunai-linux-x64.${label}`,
        build(releaseTarget, body),
        releaseTarget,
      );

      expect(result.sizeBytes).toBe(body.length);
      expect(result.sha256).toBe(sha256(body));
      expect(new Uint8Array(await Bun.file(result.output).arrayBuffer())).toEqual(body);
    });
  }

  test("streams the Windows zip through the buffered reader", async () => {
    const releaseTarget = target("windows-x64");
    const binary = encoder.encode("MZ-streamed");
    const result = await extractFile(
      releaseTarget.archiveName,
      createReleaseArchive(releaseTarget, binary),
      releaseTarget,
    );

    expect(result.sha256).toBe(sha256(binary));
  });

  test("rejects a second member and leaves no partial output", async () => {
    const releaseTarget = target("linux-x64");
    const archive = createReleaseArchive(releaseTarget, body);
    const tar = new Uint8Array(gunzipSync(archive));
    const memberLength = 512 + Math.ceil(body.length / 512) * 512;
    const doubled = new Uint8Array(memberLength * 2 + 1_024);
    doubled.set(tar.subarray(0, memberLength), 0);
    doubled.set(tar.subarray(0, memberLength), memberLength);
    const archivePath = join(scratch, "doubled.tar.zst");
    writeFileSync(archivePath, zstdCompressSync(doubled));
    const output = join(scratch, "doubled.bin");

    await expect(
      extractReleaseArchiveFile({
        archivePath,
        archiveName: "kunai-linux-x64.tar.zst",
        target: releaseTarget,
        outputPath: output,
      }),
    ).rejects.toThrow(/exactly one/i);
    expect(existsSync(output)).toBe(false);
  });

  test("rejects data after the trailer and a truncated stream", async () => {
    const releaseTarget = target("linux-x64");
    const tar = new Uint8Array(gunzipSync(createReleaseArchive(releaseTarget, body)));
    const trailing = new Uint8Array(tar.length + 512);
    trailing.set(tar);
    trailing[tar.length + 3] = 1;

    await expect(
      extractFile("kunai-linux-x64.tar.zst", zstdCompressSync(trailing), releaseTarget),
    ).rejects.toThrow(/after its trailer/i);
    await expect(
      extractFile(
        "kunai-linux-x64.tar.zst",
        zstdCompressSync(tar.subarray(0, 4_096)),
        releaseTarget,
      ),
    ).rejects.toThrow(/truncated/i);
  });

  test("maps corrupt compressed bytes to the decompression error", async () => {
    const releaseTarget = target("linux-x64");
    const archive = createZstdReleaseArchive(releaseTarget, body);
    const corrupt = new Uint8Array(archive);
    const middle = Math.floor(corrupt.length / 2);
    corrupt[middle] = (corrupt[middle] ?? 0) ^ 0xff;

    await expect(extractFile("kunai-linux-x64.tar.zst", corrupt, releaseTarget)).rejects.toThrow(
      /decompression/i,
    );
  });

  test("stops at the decompressed output budget", async () => {
    const releaseTarget = { ...target("linux-x64"), maxBinaryBytes: 1_024 };
    const archive = createZstdReleaseArchive(target("linux-x64"), body);

    await expect(extractFile("kunai-linux-x64.tar.zst", archive, releaseTarget)).rejects.toThrow(
      /budget/i,
    );
  });

  test("checks the archive size before reading it", async () => {
    const releaseTarget = { ...target("linux-x64"), maxArchiveBytes: 8 };

    await expect(
      extractFile(
        "kunai-linux-x64.tar.gz",
        createReleaseArchive(releaseTarget, body),
        releaseTarget,
      ),
    ).rejects.toThrow(/archive size/i);
  });
});
