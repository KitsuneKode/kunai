import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearPosterDiskCache,
  MAX_POSTER_DISK_CACHE_BYTES,
  MAX_POSTER_DISK_CACHE_ENTRIES,
  posterDiskCacheFileName,
  posterDiskCacheProtocol,
  readPosterDiskCache,
  setPosterDiskCacheDir,
  writePosterDiskCache,
} from "@/app-shell/poster-disk-cache";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

describe("poster disk cache", () => {
  let dir: string;
  beforeEach(async () => {
    // SAFETY: isolated tmp dir — the disk cache must never touch the live profile in tests.
    dir = await mkdtemp(join(tmpdir(), "kunai-poster-disk-test-"));
    setPosterDiskCacheDir(dir);
  });
  afterEach(async () => {
    setPosterDiskCacheDir(null);
    await rm(dir, { recursive: true, force: true });
  });

  test("round-trips validated bytes under a (url, width, protocol) key", async () => {
    const parts = { url: "https://cdn.example/x.jpg", cols: 18 };
    await writePosterDiskCache(parts, PNG_BYTES);
    const read = await readPosterDiskCache(parts, 1024 * 1024);
    expect(read).toEqual(PNG_BYTES);
  });

  test("width is part of the key: rail fetch never serves hero bytes", async () => {
    const rail = { url: "https://cdn.example/x.jpg", cols: 18 };
    const hero = { url: "https://cdn.example/x.jpg", cols: 40 };
    await writePosterDiskCache(rail, PNG_BYTES);
    expect(await readPosterDiskCache(hero, 1024 * 1024)).toBeNull();
    expect(posterDiskCacheFileName(rail)).not.toBe(posterDiskCacheFileName(hero));
  });

  test("protocol is part of the key; local paths skip the disk", async () => {
    expect(posterDiskCacheProtocol("https://cdn.example/x.jpg")).toBe("https");
    expect(posterDiskCacheProtocol("http://cdn.example/x.jpg")).toBe("http");
    expect(posterDiskCacheProtocol("/data/thumb.jpg")).toBeNull();
    expect(posterDiskCacheProtocol("file:///data/thumb.jpg")).toBeNull();
    expect(posterDiskCacheFileName({ url: "/data/thumb.jpg", cols: 18 })).toBeNull();
  });

  test("oversize entries read as a miss", async () => {
    const parts = { url: "https://cdn.example/big.jpg", cols: 18 };
    await writePosterDiskCache(parts, PNG_BYTES);
    expect(await readPosterDiskCache(parts, 2)).toBeNull();
  });

  test("clear drops every entry", async () => {
    await writePosterDiskCache({ url: "https://cdn.example/a.jpg", cols: 18 }, PNG_BYTES);
    await writePosterDiskCache({ url: "https://cdn.example/b.jpg", cols: 18 }, PNG_BYTES);
    await clearPosterDiskCache();
    expect(await readdir(dir)).toEqual([]);
    expect(MAX_POSTER_DISK_CACHE_ENTRIES).toBeGreaterThan(0);
    expect(MAX_POSTER_DISK_CACHE_BYTES).toBeGreaterThan(0);
  });
});
