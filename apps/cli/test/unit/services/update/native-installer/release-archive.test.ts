import { describe, expect, test } from "bun:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { extractReleaseArchive } from "@/services/update/native-installer/release-archive";
import {
  RELEASE_BINARY_TARGETS,
  type ReleaseBinaryTarget,
} from "@/services/update/platform-assets";

import { createReleaseArchive } from "../../../../../scripts/build-release-archives";

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
