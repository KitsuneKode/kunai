import { describe, expect, test } from "bun:test";

import {
  gatewayContentType,
  parseGatewayRange,
  startLocalMediaGateway,
} from "@/infra/player/local-media-gateway";

describe("gateway range parsing", () => {
  test("resolves closed, open, and overlong ranges", () => {
    expect(parseGatewayRange("bytes=0-1023", 4096)).toEqual({
      ok: true,
      range: { start: 0, end: 1023 },
    });
    expect(parseGatewayRange("bytes=100-", 4096)).toEqual({
      ok: true,
      range: { start: 100, end: 4095 },
    });
    expect(parseGatewayRange("bytes=0-99999", 4096)).toEqual({
      ok: true,
      range: { start: 0, end: 4095 },
    });
  });

  test("rejects missing, suffix, malformed, and past-end ranges", () => {
    expect(parseGatewayRange(null, 4096).ok).toBe(false);
    expect(parseGatewayRange("bytes=-500", 4096).ok).toBe(false);
    expect(parseGatewayRange("bytes=abc-def", 4096).ok).toBe(false);
    expect(parseGatewayRange("bytes=500-100", 4096).ok).toBe(false);
    expect(parseGatewayRange("bytes=4096-", 4096).ok).toBe(false);
  });

  test("maps container extensions to content types", () => {
    expect(gatewayContentType("show.mkv")).toBe("video/x-matroska");
    expect(gatewayContentType("SHOW.MP4")).toBe("video/mp4");
    expect(gatewayContentType("weird.bin")).toBe("application/octet-stream");
  });
});

function byteSource(total: number) {
  const data = new Uint8Array(total);
  for (let i = 0; i < total; i++) data[i] = i & 0xff;
  return {
    async *readRange(start: number, end: number): AsyncIterable<Uint8Array> {
      yield data.subarray(start, end + 1);
    },
  };
}

describe("local media gateway", () => {
  test("serves torrent mounts with 206 slices and rejects strangers", async () => {
    const gateway = startLocalMediaGateway();
    try {
      const source = byteSource(10_000);
      const url = gateway.mountTorrentFile({
        mountId: "m1",
        fileName: "show.mp4",
        fileLength: 10_000,
        contentType: gatewayContentType("show.mp4"),
        readRange: (start, end) => source.readRange(start, end),
      });
      const sliced = await fetch(url, { headers: { Range: "bytes=100-199" } });
      expect(sliced.status).toBe(206);
      expect(sliced.headers.get("content-range")).toBe("bytes 100-199/10000");
      expect(sliced.headers.get("accept-ranges")).toBe("bytes");
      const body = new Uint8Array(await sliced.arrayBuffer());
      expect(body.length).toBe(100);
      expect(body[0]).toBe(100);
      expect(body[99]).toBe(199);

      const full = await fetch(url);
      expect(full.status).toBe(200);
      expect((await full.arrayBuffer()).byteLength).toBe(10_000);
      const head = await fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe("10000");
      expect((await head.arrayBuffer()).byteLength).toBe(0);
      expect((await fetch(url, { method: "POST" })).status).toBe(405);
      expect((await fetch(`${gateway.origin}/t/wrong-token/m1/stream`)).status).toBe(403);
      expect((await fetch(`${gateway.origin}/t/${"0".repeat(32)}/nope/stream`)).status).toBe(403);
    } finally {
      gateway.stop("playback-end");
    }
  });

  test("never exposes an upstream proxy route", async () => {
    const gateway = startLocalMediaGateway();
    try {
      const url = gateway.mountTorrentFile({
        mountId: "fixture",
        fileName: "video.mp4",
        fileLength: 4,
        contentType: "video/mp4",
        readRange: () => byteSource(4).readRange(0, 3),
      });
      const legacyProxyUrl = url.replace("/t/", "/h/");
      expect((await fetch(legacyProxyUrl)).status).toBe(403);
    } finally {
      gateway.stop();
    }
  });
});

test("a queued idle timer cannot interrupt an active torrent response", async () => {
  const tasks: (() => void)[] = [];
  const reasons: string[] = [];
  let release!: () => void;
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gateway = startLocalMediaGateway({
    scheduleIdle(task) {
      tasks.push(task);
      return () => {};
    },
    onStopped(reason) {
      reasons.push(reason);
    },
  });
  try {
    const url = gateway.mountTorrentFile({
      mountId: "active",
      fileName: "video.mp4",
      fileLength: 8,
      contentType: "video/mp4",
      async *readRange() {
        yield new Uint8Array(4);
        await resume;
        yield new Uint8Array(4);
      },
    });
    const response = await fetch(url);
    tasks[0]?.();
    expect(reasons).toEqual([]);
    release();
    expect((await response.arrayBuffer()).byteLength).toBe(8);
    gateway.stop();
    expect(reasons).toEqual(["playback-end"]);
  } finally {
    release();
    gateway.stop();
  }
});

test("HEAD never opens a torrent file stream and mount admission is bounded", async () => {
  const gateway = startLocalMediaGateway();
  let reads = 0;
  const mount = {
    fileName: "video.mp4",
    fileLength: 4,
    contentType: "video/mp4",
    async *readRange() {
      reads++;
      yield new Uint8Array(4);
    },
  };
  try {
    const url = gateway.mountTorrentFile({ ...mount, mountId: "head" });
    const response = await fetch(url, { method: "HEAD", headers: { range: "bytes=1-2" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(reads).toBe(0);
    for (let index = 1; index < 16; index++)
      gateway.mountTorrentFile({ ...mount, mountId: `m${index}` });
    expect(() => gateway.mountTorrentFile({ ...mount, mountId: "overflow" })).toThrow(
      "too many torrent mounts",
    );
    gateway.unmountTorrentFile("head");
    expect(() => gateway.mountTorrentFile({ ...mount, mountId: "replacement" })).not.toThrow();
    expect(() => gateway.mountTorrentFile({ ...mount, mountId: "../escape" })).toThrow(
      "invalid torrent mount",
    );
  } finally {
    gateway.stop();
  }
});
