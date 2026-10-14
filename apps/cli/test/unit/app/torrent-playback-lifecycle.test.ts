import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { playTorrentMagnet, type TorrentPlaybackContext } from "@/app/torrent/torrent-playback";
import type { TorrentEngine } from "@/services/torrent/torrent-engine";
import type { WebTorrentTorrent } from "webtorrent";

const MAGNET = "magnet:?xt=urn:btih:" + "a".repeat(40);

function context(): TorrentPlaybackContext {
  return {
    config: { debridApiKey: "configured-user-token" },
    stateManager: { dispatch() {} },
    diagnosticsService: { record() {} },
    player: {
      async play() {
        throw new Error("unexpected player launch");
      },
    },
  };
}

test("metadata cancellation releases gateway and engine without contacting debrid", async () => {
  const controller = new AbortController();
  const releases: string[] = [];
  let debridCalls = 0;
  const engine: TorrentEngine = {
    async addMagnet(_magnet, options) {
      expect(options?.signal).toBe(controller.signal);
      controller.abort(new Error("cancelled"));
      throw controller.signal.reason;
    },
    async awaitFileHead() {
      throw new Error("unexpected readiness");
    },
    async readContiguousHead() {
      return new Uint8Array();
    },
    progress() {
      return { downloaded: 0, speed: 0, peers: 0 };
    },
    destroyTorrent() {},
    destroy() {
      releases.push("engine");
    },
  };
  const outcome = await playTorrentMagnet(
    context(),
    MAGNET,
    { signal: controller.signal },
    {
      createEngine: () => engine,
      createGateway: () => ({
        origin: "http://127.0.0.1:0",
        stop() {
          releases.push("gateway");
        },
        mountTorrentFile() {
          throw new Error("unexpected mount");
        },
        unmountTorrentFile() {},
      }),
      createDebrid: () => ({
        async unrestrict() {
          debridCalls++;
          throw new Error("unexpected debrid");
        },
      }),
    },
  );
  expect(outcome).toEqual({ status: "cancelled" });
  expect(releases).toEqual(["gateway", "engine"]);
  expect(debridCalls).toBe(0);
});

test("readiness cancellation releases resources and cannot authorize fallback", async () => {
  const controller = new AbortController();
  const releases: string[] = [];
  let debridCalls = 0;
  class FixtureTorrent extends EventEmitter implements WebTorrentTorrent {
    infoHash = "a".repeat(40);
    magnetURI = MAGNET;
    name = "fixture";
    files = [];
    pieces = [];
    pieceLength = 0;
    downloaded = 0;
    uploaded = 0;
    downloadSpeed = 0;
    numPeers = 0;
    done = false;
    ready = true;
    select() {}
    deselect() {}
    destroy() {}
    addPeer() {
      return true;
    }
  }
  const torrent = new FixtureTorrent();
  const engine: TorrentEngine = {
    async addMagnet() {
      return torrent;
    },
    async awaitFileHead() {
      controller.abort(new Error("cancelled"));
      throw controller.signal.reason;
    },
    async readContiguousHead() {
      return new Uint8Array();
    },
    progress() {
      return { downloaded: 0, speed: 0, peers: 0 };
    },
    destroyTorrent() {},
    destroy() {
      releases.push("engine");
    },
  };
  const outcome = await playTorrentMagnet(
    context(),
    MAGNET,
    { signal: controller.signal },
    {
      createEngine: () => engine,
      createGateway: () => ({
        origin: "http://127.0.0.1:0",
        stop() {
          releases.push("gateway");
        },
        mountTorrentFile() {
          throw new Error("unexpected mount");
        },
        unmountTorrentFile() {},
      }),
      createDebrid: () => ({
        async unrestrict() {
          debridCalls++;
          throw new Error("unexpected debrid");
        },
      }),
    },
  );
  expect(outcome).toEqual({ status: "cancelled" });
  expect(releases).toEqual(["gateway", "engine"]);
  expect(debridCalls).toBe(0);
});
