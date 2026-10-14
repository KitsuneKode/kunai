import { describe, expect, test } from "bun:test";

import {
  assessTorrentReadiness,
  classifyContainer,
  isVideoFilename,
  pickVideoFile,
  scanMp4Boxes,
} from "@/services/torrent/readiness";

function mp4Box(type: string, payloadSize = 0): Uint8Array {
  const size = 8 + payloadSize;
  const out = new Uint8Array(size);
  out[0] = (size >>> 24) & 0xff;
  out[1] = (size >>> 16) & 0xff;
  out[2] = (size >>> 8) & 0xff;
  out[3] = size & 0xff;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("torrent readiness gate", () => {
  test("fast-start mp4 with moov up front is ready", () => {
    const prefix = concat(mp4Box("ftyp", 16), mp4Box("moov", 64), mp4Box("mdat", 64));
    expect(classifyContainer(prefix)).toBe("mp4");
    const assessment = assessTorrentReadiness(prefix, 100_000_000);
    expect(assessment.ready).toBe(true);
    expect(assessment.container).toBe("mp4");
  });

  test("mp4 with ftyp but no moov yet is not ready", () => {
    const prefix = concat(mp4Box("ftyp", 16), new Uint8Array(1024));
    const assessment = assessTorrentReadiness(prefix, 100_000_000);
    expect(assessment.ready).toBe(false);
    expect(assessment.reason).toContain("moov");
  });

  test("complete or truncated MP4 data without a complete moov does not pass", () => {
    const missing = mp4Box("ftyp", 16);
    expect(assessTorrentReadiness(missing, missing.length).ready).toBe(false);
    const truncated = concat(missing, mp4Box("moov", 64).subarray(0, 8));
    expect(assessTorrentReadiness(truncated, 1000).ready).toBe(false);
  });

  test("matroska is ready on the EBML head alone", () => {
    const prefix = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);
    expect(classifyContainer(prefix)).toBe("matroska");
    expect(assessTorrentReadiness(prefix, 500_000_000).ready).toBe(true);
  });

  test("unrecognized bytes never count as a proven container", () => {
    const prefix = new Uint8Array(100);
    expect(assessTorrentReadiness(prefix, 100_000_000).ready).toBe(false);
    expect(assessTorrentReadiness(prefix, 100).ready).toBe(false);
    expect(assessTorrentReadiness(new Uint8Array(2_097_152), 100_000_000).ready).toBe(false);
  });

  test("scanMp4Boxes finds moov offsets and mdat presence", () => {
    const prefix = concat(mp4Box("ftyp", 8), mp4Box("moov", 8), mp4Box("mdat", 8));
    const scan = scanMp4Boxes(prefix);
    expect(scan.hasFtyp).toBe(true);
    expect(scan.moovOffset).toBe(16);
    expect(scan.hasMdat).toBe(true);
  });

  test("picks the largest video file and ignores sidecars", () => {
    const files = [
      { name: "movie.srt", length: 50_000 },
      { name: "sample.mp4", length: 80_000_000 },
      { name: "movie.mkv", length: 4_000_000_000 },
      { name: "cover.jpg", length: 2_000_000 },
    ];
    expect(pickVideoFile(files)?.name).toBe("movie.mkv");
    expect(pickVideoFile([{ name: "notes.txt", length: 10 }])).toBeNull();
    expect(isVideoFilename("SHOW.S01E01.MP4")).toBe(true);
    expect(isVideoFilename("audio.flac")).toBe(false);
  });
});
