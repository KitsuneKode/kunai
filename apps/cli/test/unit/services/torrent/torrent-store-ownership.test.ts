import { afterEach, beforeEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTorrentEngine } from "@/services/torrent/torrent-engine";
import { getKunaiPaths } from "@kunai/storage";
import type { WebTorrentAddOptions, WebTorrentTorrent } from "webtorrent";

import { applyStorageRootEnv } from "../../../helpers/storage-env";

let root: string;
let restore: () => void;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kunai-torrent-ownership-"));
  restore = applyStorageRootEnv(root);
});
afterEach(() => {
  restore();
  rmSync(root, { recursive: true, force: true });
});

class FixtureTorrent extends EventEmitter implements WebTorrentTorrent {
  magnetURI = "magnet:fixture";
  pieces = [];
  infoHash = "fixture";
  name = "same-file";
  files = [];
  length = 0;
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

function fixtureClient(options: WebTorrentAddOptions[]) {
  return {
    add(_magnet: string | Buffer | Uint8Array, opts?: WebTorrentAddOptions) {
      options.push(opts ?? {});
      const torrent = new FixtureTorrent();
      queueMicrotask(() => torrent.emit("ready"));
      return torrent;
    },
    destroy() {},
  };
}

test("concurrent attempts use different private stores under the isolated root", async () => {
  const options: WebTorrentAddOptions[] = [];
  const first = createTorrentEngine({}, { createClient: async () => fixtureClient(options) });
  const second = createTorrentEngine({}, { createClient: async () => fixtureClient(options) });
  try {
    await Promise.all([first.addMagnet("fixture"), second.addMagnet("fixture")]);
    const [one, two] = options;
    expect(one?.path).toBeDefined();
    expect(two?.path).toBeDefined();
    expect(one?.path).not.toBe(two?.path);
    for (const option of options) {
      expect(option.path?.startsWith(getKunaiPaths().tempDir)).toBe(true);
      const path = option.path;
      if (!path) throw new Error("missing private torrent path");
      expect(existsSync(path)).toBe(true);
      if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o700);
      expect(option.destroyStoreOnDestroy).toBe(true);
      expect(option.deselect).toBe(true);
    }
  } finally {
    first.destroy();
    second.destroy();
  }
});
