import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTorrentEngine } from "@/services/torrent/torrent-engine";
import type { WebTorrentFile, WebTorrentTorrent } from "webtorrent";

import { applyStorageRootEnv } from "../../../helpers/storage-env";

class PendingTorrent extends EventEmitter implements WebTorrentTorrent {
  magnetURI = "magnet:fixture";
  pieces = [];
  infoHash = "fixture";
  name = "fixture";
  files: WebTorrentFile[] = [];
  length = 0;
  pieceLength = 0;
  downloaded = 0;
  uploaded = 0;
  downloadSpeed = 0;
  numPeers = 0;
  done = false;
  ready = false;
  destroyed = false;
  select() {}
  deselect() {}
  destroy() {
    this.destroyed = true;
  }
  addPeer() {
    return true;
  }
}

test("cancelling the metadata wait detaches listeners and destroys the attempt", async () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-torrent-cancel-"));
  const restore = applyStorageRootEnv(root);
  const controller = new AbortController();
  const torrent = new PendingTorrent();
  let attached!: () => void;
  const added = new Promise<void>((resolve) => {
    attached = resolve;
  });
  const engine = createTorrentEngine(
    {},
    {
      createClient: async () => ({
        add() {
          queueMicrotask(attached);
          return torrent;
        },
        on() {
          return this;
        },
        destroy() {},
      }),
    },
  );
  try {
    const pending = engine.addMagnet("fixture", { signal: controller.signal });
    const observed = pending.catch((error: Error) => error);
    await added;
    controller.abort(new Error("torrent cancelled by user"));
    expect(await observed).toEqual(
      expect.objectContaining({ message: "torrent cancelled by user" }),
    );
    expect(torrent.destroyed).toBe(true);
    expect(torrent.listenerCount("ready")).toBe(0);
    expect(torrent.listenerCount("metadata")).toBe(0);
  } finally {
    engine.destroy();
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a readiness deadline interrupts a stalled head read", async () => {
  const callbacks: (() => void)[] = [];
  const engine = createTorrentEngine(
    {},
    {
      scheduleTimeout: (task) => {
        callbacks.push(task);
        return () => {};
      },
    },
  );
  const torrent = new PendingTorrent();
  torrent.ready = true;
  let reading!: () => void;
  const started = new Promise<void>((resolve) => {
    reading = resolve;
  });
  let stopped = false;
  torrent.files = [
    {
      name: "video.mp4",
      length: 3_000_000,
      downloaded: 0,
      select() {},
      deselect() {},
      createReadStream() {
        let rejectRead!: (error: Error) => void;
        const next = new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
          rejectRead = reject;
        });
        reading();
        return {
          [Symbol.asyncIterator]() {
            return { next: () => next };
          },
          destroy(error) {
            stopped = true;
            rejectRead(error ?? new Error("closed"));
          },
        };
      },
    },
  ];
  const pending = engine.awaitFileHead(torrent);
  const observed = pending.catch((error: Error) => error);
  await started;
  callbacks.at(-1)?.();
  expect(await observed).toEqual(
    expect.objectContaining({ message: "torrent readiness timed out" }),
  );
  expect(stopped).toBe(true);
  engine.destroy();
});

test("closing before client creation completes tears it down exactly once", async () => {
  let resolveClient!: (client: { add(): PendingTorrent; on(): void; destroy(): void }) => void;
  const client = new Promise<{ add(): PendingTorrent; on(): void; destroy(): void }>((resolve) => {
    resolveClient = resolve;
  });
  let destroys = 0;
  let adds = 0;
  const engine = createTorrentEngine({}, { createClient: () => client });
  const pending = engine.addMagnet("fixture").catch((error: Error) => error);
  engine.destroy();
  resolveClient({
    add() {
      adds++;
      return new PendingTorrent();
    },
    on() {},
    destroy() {
      destroys++;
    },
  });
  expect(await pending).toEqual(expect.objectContaining({ message: "torrent engine closed" }));
  expect(destroys).toBe(1);
  expect(adds).toBe(0);
});
