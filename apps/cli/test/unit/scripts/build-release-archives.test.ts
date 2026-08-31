import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import { buildReleaseArchives } from "../../../scripts/build-release-archives";

const SCRIPT = join(import.meta.dirname, "../../../scripts/build-release-archives.ts");

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixtureDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `${label} with spaces-`));
  for (const target of RELEASE_BINARY_TARGETS) {
    writeFileSync(join(directory, target.out), `fixture:${target.id}\n`);
  }
  return directory;
}

function runBuilder(directory: string): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({
    cmd: [process.execPath, SCRIPT, "--directory", directory],
    stdout: "pipe",
    stderr: "pipe",
  });
}

function octalField(block: Uint8Array, offset: number, length: number): number {
  const decoded = new TextDecoder().decode(block.subarray(offset, offset + length));
  const value = decoded
    .slice(0, decoded.indexOf("\0") < 0 ? undefined : decoded.indexOf("\0"))
    .trim();
  return Number.parseInt(value || "0", 8);
}

function readTarGz(path: string) {
  const tar = gunzipSync(readFileSync(path));
  const header = tar.subarray(0, 512);
  const decodedName = new TextDecoder().decode(header.subarray(0, 100));
  const name = decodedName.slice(
    0,
    decodedName.indexOf("\0") < 0 ? undefined : decodedName.indexOf("\0"),
  );
  const size = octalField(header, 124, 12);
  return {
    name,
    mode: octalField(header, 100, 8),
    uid: octalField(header, 108, 8),
    gid: octalField(header, 116, 8),
    mtime: octalField(header, 136, 12),
    type: header[156],
    body: tar.subarray(512, 512 + size),
    trailing: tar.subarray(512 + Math.ceil(size / 512) * 512),
  };
}

function readZip(path: string) {
  const zip = readFileSync(path);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  const method = view.getUint16(8, true);
  const dosTime = view.getUint16(10, true);
  const dosDate = view.getUint16(12, true);
  const compressedSize = view.getUint32(18, true);
  const uncompressedSize = view.getUint32(22, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = new TextDecoder().decode(zip.subarray(30, 30 + nameLength));
  const bodyStart = 30 + nameLength + extraLength;
  const compressed = zip.subarray(bodyStart, bodyStart + compressedSize);
  const body = method === 8 ? inflateRawSync(compressed) : compressed;
  const centralOffset = bodyStart + compressedSize;
  expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
  const externalAttributes = view.getUint32(centralOffset + 38, true);
  return { name, dosTime, dosDate, body, uncompressedSize, externalAttributes };
}

describe("deterministic release archive builder", () => {
  test("publishes Android binaries as deterministic tar archives", () => {
    const androidTargets = RELEASE_BINARY_TARGETS.filter((target) => target.os === "android");
    expect(
      androidTargets.map((target) => ({
        id: target.id,
        triple: target.triple,
        archive: target.archiveName,
        format: target.archiveFormat,
      })),
    ).toEqual([
      {
        id: "android-arm64",
        triple: "bun-linux-arm64-android",
        archive: "kunai-android-arm64.tar.gz",
        format: "tar.gz",
      },
      {
        id: "android-x64",
        triple: "bun-linux-x64-android",
        archive: "kunai-android-x64.tar.gz",
        format: "tar.gz",
      },
    ]);
  });

  test("builds the exact archive/raw bridge set with separate sorted manifests", () => {
    const directory = fixtureDirectory("kunai archives");
    try {
      const result = runBuilder(directory);
      expect(result.exitCode, result.stderr?.toString() ?? "").toBe(0);
      expect(readdirSync(directory).sort()).toEqual(
        [
          ...RELEASE_BINARY_TARGETS.flatMap((target) => [target.out, target.archiveName]),
          "SHA256SUMS",
          "SHA256SUMS.archives",
        ].sort(),
      );

      const archiveRows = readFileSync(join(directory, "SHA256SUMS.archives"), "utf8")
        .trim()
        .split("\n");
      const rawRows = readFileSync(join(directory, "SHA256SUMS"), "utf8").trim().split("\n");
      expect(archiveRows.map((row) => row.slice(66))).toEqual(
        RELEASE_BINARY_TARGETS.map((target) => target.archiveName).sort(),
      );
      expect(rawRows.map((row) => row.slice(66))).toEqual(
        RELEASE_BINARY_TARGETS.map((target) => target.out).sort(),
      );
      for (const row of [...archiveRows, ...rawRows]) {
        const [digest, name] = row.split("  ") as [string, string];
        expect(digest).toBe(sha256(readFileSync(join(directory, name))));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rebuilds byte-for-byte despite source mode and timestamp differences", () => {
    const first = fixtureDirectory("kunai reproducible first");
    const second = fixtureDirectory("kunai reproducible second");
    try {
      for (const target of RELEASE_BINARY_TARGETS) {
        chmodSync(join(first, target.out), 0o700);
        chmodSync(join(second, target.out), 0o644);
        utimesSync(join(first, target.out), new Date(1_000), new Date(2_000));
        utimesSync(join(second, target.out), new Date(3_000_000), new Date(4_000_000));
      }
      expect(runBuilder(first).exitCode).toBe(0);
      expect(runBuilder(second).exitCode).toBe(0);
      for (const target of RELEASE_BINARY_TARGETS) {
        expect(readFileSync(join(first, target.archiveName))).toEqual(
          readFileSync(join(second, target.archiveName)),
        );
      }
      expect(readFileSync(join(first, "SHA256SUMS.archives"))).toEqual(
        readFileSync(join(second, "SHA256SUMS.archives")),
      );
      expect(readFileSync(join(first, "SHA256SUMS"))).toEqual(
        readFileSync(join(second, "SHA256SUMS")),
      );
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("an incremental target rebuild reconciles every retained raw target", () => {
    const directory = fixtureDirectory("kunai retained targets");
    try {
      expect(runBuilder(directory).exitCode).toBe(0);
      const rebuilt = RELEASE_BINARY_TARGETS[0]!;
      writeFileSync(join(directory, rebuilt.out), "updated linux x64\n");

      buildReleaseArchives(directory, [rebuilt]);

      const rawRows = readFileSync(join(directory, "SHA256SUMS"), "utf8").trim().split("\n");
      const archiveRows = readFileSync(join(directory, "SHA256SUMS.archives"), "utf8")
        .trim()
        .split("\n");
      expect(rawRows.map((row) => row.slice(66))).toEqual(
        RELEASE_BINARY_TARGETS.map((target) => target.out).sort(),
      );
      expect(archiveRows.map((row) => row.slice(66))).toEqual(
        RELEASE_BINARY_TARGETS.map((target) => target.archiveName).sort(),
      );
      expect(readTarGz(join(directory, rebuilt.archiveName)).body).toEqual(
        readFileSync(join(directory, rebuilt.out)),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("an incremental rebuild removes a stale canonical archive with no retained raw binary", () => {
    const directory = fixtureDirectory("kunai removed retained target");
    try {
      expect(runBuilder(directory).exitCode).toBe(0);
      const retained = RELEASE_BINARY_TARGETS[0]!;
      const removed = RELEASE_BINARY_TARGETS.at(-1)!;
      rmSync(join(directory, removed.out));

      buildReleaseArchives(directory, [retained]);

      expect(existsSync(join(directory, removed.archiveName))).toBe(false);
      expect(readFileSync(join(directory, "SHA256SUMS"), "utf8")).not.toContain(removed.out);
      expect(readFileSync(join(directory, "SHA256SUMS.archives"), "utf8")).not.toContain(
        removed.archiveName,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects an unknown stale archive before rewriting preserved manifests", () => {
    const directory = fixtureDirectory("kunai unknown stale archive");
    try {
      expect(runBuilder(directory).exitCode).toBe(0);
      const rawManifestBefore = readFileSync(join(directory, "SHA256SUMS"));
      const archiveManifestBefore = readFileSync(join(directory, "SHA256SUMS.archives"));
      writeFileSync(join(directory, "kunai-unknown-target.zip"), "stale archive");

      expect(() => buildReleaseArchives(directory, [RELEASE_BINARY_TARGETS[0]!])).toThrow(
        /unexpected stale release archive.*kunai-unknown-target\.zip/i,
      );
      expect(readFileSync(join(directory, "SHA256SUMS"))).toEqual(rawManifestBefore);
      expect(readFileSync(join(directory, "SHA256SUMS.archives"))).toEqual(archiveManifestBefore);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("writes canonical tar metadata and exactly one raw-named executable member", () => {
    const directory = fixtureDirectory("kunai tar metadata");
    try {
      expect(runBuilder(directory).exitCode).toBe(0);
      const target = RELEASE_BINARY_TARGETS.find((entry) => entry.id === "linux-x64")!;
      const archive = readTarGz(join(directory, target.archiveName));
      expect(archive.name).toBe(target.out);
      expect(archive.mode).toBe(0o755);
      expect(archive.uid).toBe(0);
      expect(archive.gid).toBe(0);
      expect(archive.mtime).toBe(0);
      expect([0, 48]).toContain(archive.type ?? -1);
      expect(archive.body).toEqual(readFileSync(join(directory, target.out)));
      expect([...archive.trailing]).toEqual(Array.from({ length: 1_024 }, () => 0));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("writes canonical zip metadata and one raw-named Windows member", () => {
    const directory = fixtureDirectory("kunai zip metadata");
    try {
      expect(runBuilder(directory).exitCode).toBe(0);
      const target = RELEASE_BINARY_TARGETS.find((entry) => entry.id === "windows-x64")!;
      const archive = readZip(join(directory, target.archiveName));
      expect(archive.name).toBe(target.out);
      expect(archive.name).not.toContain("\\");
      expect(archive.dosTime).toBe(0);
      expect(archive.dosDate).toBe(0x21);
      expect(archive.uncompressedSize).toBe(readFileSync(join(directory, target.out)).length);
      expect(archive.body).toEqual(readFileSync(join(directory, target.out)));
      expect(archive.externalAttributes >>> 16).toBe(0o100755);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("fails before preservation when a raw target is missing", () => {
    const directory = fixtureDirectory("kunai missing input");
    try {
      rmSync(join(directory, RELEASE_BINARY_TARGETS[3]!.out));
      const result = runBuilder(directory);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr?.toString() ?? "").toMatch(/missing.*kunai-linux-arm64-musl/i);
      expect(readdirSync(directory)).not.toContain("SHA256SUMS");
      expect(readdirSync(directory).some((name) => /\.(?:zip|tar\.gz)$/.test(name))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects an oversized raw target before reading or archiving it", () => {
    const directory = fixtureDirectory("kunai oversized input");
    try {
      const target = RELEASE_BINARY_TARGETS[0]!;
      truncateSync(join(directory, target.out), target.maxBinaryBytes + 1);
      const result = runBuilder(directory);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr?.toString() ?? "").toMatch(/size budget.*kunai-linux-x64/i);
      expect(readdirSync(directory).some((name) => /\.(?:zip|tar\.gz)$/.test(name))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
