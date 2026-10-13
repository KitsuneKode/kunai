import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTorrentEngine, type TorrentEngine } from "@/services/torrent/torrent-engine";

/**
 * Deterministic swarm: an in-process seeder over TCP loopback, no DHT or
 * trackers. Proves the engine drives metadata → pick → sequential head →
 * readiness without any network beyond 127.0.0.1.
 */
function makeMp4Seed(dir: string): string {
  const box = (type: string, payload: number): Buffer => {
    const size = 8 + payload;
    const out = Buffer.alloc(size);
    out.writeUInt32BE(size, 0);
    out.write(type, 4, "latin1");
    return out;
  };
  const head = Buffer.concat([box("ftyp", 16), box("moov", 64), box("mdat", 0)]);
  const tail = Buffer.alloc(4 * 1024 * 1024 - head.length, 0x5a);
  const path = join(dir, "seed-video.mp4");
  writeFileSync(path, Buffer.concat([head, tail]));
  return path;
}

describe("torrent engine over a loopback swarm", () => {
  let engines: TorrentEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.destroy();
    engines = [];
  });

  test("metadata, video pick, and readiness gate pass end to end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-torrent-engine-"));
    const seedPath = makeMp4Seed(dir);

    // Seed through raw webtorrent (the engine is the leecher under test).
    const { default: WebTorrent } = await import("webtorrent");
    const seeder = new WebTorrent({
      torrentPort: 0,
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
      natUpnp: false,
    });
    const seeded = await new Promise<{ magnetURI: string }>((resolve, reject) => {
      try {
        seeder.seed(seedPath, (torrent) => resolve({ magnetURI: torrent.magnetURI }));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    const seederPort = (seeder.address() as { port: number } | null)?.port;
    expect(seederPort).toBeGreaterThan(0);

    try {
      const engine = createTorrentEngine();
      engines.push(engine);
      const torrent = await engine.addMagnet(seeded.magnetURI, {
        peers: [`127.0.0.1:${seederPort}`],
      });
      const { file, assessment } = await engine.awaitFileHead(torrent, {
        metadataTimeoutMs: 20_000,
        readinessTimeoutMs: 30_000,
      });
      expect(file.name).toBe("seed-video.mp4");
      expect(assessment).toContain("moov");
      const progress = engine.progress(torrent);
      expect(progress.downloaded).toBeGreaterThan(0);
      engine.destroyTorrent(torrent);
    } finally {
      seeder.destroy();
    }
  }, 60_000);
});
