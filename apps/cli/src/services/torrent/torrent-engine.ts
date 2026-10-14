import { createPrivateTempDir } from "@/infra/fs/temp-dir";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import { assessTorrentReadiness, pickVideoFile } from "@/services/torrent/readiness";
import type { WebTorrentFile, WebTorrentTorrent } from "webtorrent";

export type TorrentEngineEvents = {
  readonly onEvent?: (event: DiagnosticEvent) => void;
};

export type TorrentEngineEventContext = {
  readonly file?: string;
  readonly container?: string;
  readonly reason?: string;
  readonly readyMs?: number;
  readonly peers?: number;
  readonly infoHash?: string;
};

export type TorrentResolveResult = {
  readonly infoHash: string;
  readonly name: string;
  readonly fileName: string;
  readonly fileLength: number;
  readonly container: string;
  readonly readyMs: number;
  readonly peerCount: number;
};

export type TorrentEngine = {
  addMagnet(
    magnet: string,
    opts?: { readonly peers?: readonly string[]; readonly signal?: AbortSignal },
  ): Promise<WebTorrentTorrent>;
  awaitFileHead(
    torrent: WebTorrentTorrent,
    options?: {
      readonly metadataTimeoutMs?: number;
      readonly readinessTimeoutMs?: number;
      readonly signal?: AbortSignal;
      readonly onProgress?: (progress: {
        readonly downloaded: number;
        readonly peers: number;
      }) => void;
    },
  ): Promise<{ readonly file: WebTorrentFile; readonly assessment: string }>;
  progress(torrent: WebTorrentTorrent): {
    readonly downloaded: number;
    readonly speed: number;
    readonly peers: number;
  };
  readContiguousHead(
    file: WebTorrentFile,
    byteCount: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
  destroyTorrent(torrent: WebTorrentTorrent): void;
  destroy(): void;
};

const METADATA_TIMEOUT_MS = 60_000;
const READINESS_TIMEOUT_MS = 120_000;
const HEAD_PROBE_BYTES = 2_097_152;
const HEAD_POLL_MS = 500;

async function loadWebTorrent(): Promise<typeof import("webtorrent")> {
  // Dynamic import: non-torrent sessions never pay the webtorrent load cost,
  // and the native-stub preload mapping applies to dynamic imports as well.
  return import("webtorrent");
}

type ScheduleTimeout = (task: () => void, delayMs: number) => () => void;
const scheduleTimeout: ScheduleTimeout = (task, delayMs) => {
  const timer = setTimeout(task, delayMs);
  return () => clearTimeout(timer);
};

function waitFor(
  register: (done: () => void, fail: (error: Error) => void) => () => void,
  timeoutMs: number,
  what: string,
  schedule: ScheduleTimeout,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("torrent cancelled"));
      return;
    }
    let settled = false;
    let unregister = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cancelTimer();
      signal?.removeEventListener("abort", onAbort);
      unregister();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () =>
      finish(signal?.reason instanceof Error ? signal.reason : new Error("torrent cancelled"));
    const cancelTimer = schedule(() => finish(new Error(`torrent ${what} timed out`)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      unregister = register(() => finish(), finish);
      if (settled) unregister();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function delay(ms: number, schedule: ScheduleTimeout, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      cancel();
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    const cancel = schedule(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForMetadata(
  torrent: WebTorrentTorrent,
  timeoutMs: number,
  schedule: ScheduleTimeout,
  signal?: AbortSignal,
): Promise<void> {
  return waitFor(
    (done, fail) => {
      if (torrent.ready) {
        done();
        return () => {};
      }
      torrent.on("ready", done);
      torrent.on("metadata", done);
      torrent.on("error", fail);
      return () => {
        torrent.off("ready", done);
        torrent.off("metadata", done);
        torrent.off("error", fail);
      };
    },
    timeoutMs,
    "metadata",
    schedule,
    signal,
  );
}

type TorrentClient = Pick<import("webtorrent").default, "add" | "destroy"> & {
  on(event: "error", listener: (error: Error) => void): void;
};

export type TorrentEngineDeps = {
  readonly createClient?: () => Promise<TorrentClient>;
  readonly scheduleTimeout?: ScheduleTimeout;
};

export function createTorrentEngine(
  events: TorrentEngineEvents = {},
  deps: TorrentEngineDeps = {},
): TorrentEngine {
  // One client per engine: DHT, trackers, and LSD fan out per torrent, and a
  // shared client would let one stalled magnet hold the swarm ports of others.
  // The client is created lazily on first use so importing this module costs
  // nothing for non-torrent sessions.
  let clientPromise: Promise<TorrentClient> | null = null;
  let destroyed = false;
  const schedule = deps.scheduleTimeout ?? scheduleTimeout;
  const client = (): Promise<TorrentClient> => {
    if (destroyed) return Promise.reject(new Error("torrent engine closed"));
    clientPromise ??= (
      deps.createClient
        ? deps.createClient()
        : loadWebTorrent().then(
            ({ default: WebTorrent }) =>
              new WebTorrent({
                torrentPort: 0,
                dht: true,
                tracker: true,
                lsd: true,
                // No WebRTC peers (stubbed out at build; see torrent-native-stubs)
                // and no µTP (native addon Bun cannot run): TCP swarm only.
                utp: false,
                natUpnp: false,
              }),
          )
    ).then((instance) => {
      instance.on("error", () => record("torrent client error"));
      return instance;
    });
    return clientPromise.then((instance) => {
      if (destroyed) {
        // destroy() already owns the pending client teardown. WebTorrent
        // throws on a second destroy, so this continuation only fences add.
        throw new Error("torrent engine closed");
      }
      return instance;
    });
  };

  const record = (message: string, context: TorrentEngineEventContext = {}) => {
    events.onEvent?.({
      timestamp: Date.now(),
      level: "info",
      category: "provider",
      operation: "torrent.engine",
      message,
      context,
    });
  };

  return {
    async addMagnet(magnet, opts = {}) {
      opts.signal?.throwIfAborted();
      const instance = await client();
      opts.signal?.throwIfAborted();
      // WebTorrent's default /tmp/webtorrent store is shared by filename.
      // Destroying a colliding attempt would delete a sibling's live files.
      // A fresh owner-only directory fences every attempt, including same-hash
      // sessions; deselect prevents downloading an entire pack before selection.
      const path = await createPrivateTempDir("torrent");
      opts.signal?.throwIfAborted();
      if (destroyed) throw new Error("torrent engine closed");
      const torrent = instance.add(magnet, { path, deselect: true, destroyStoreOnDestroy: true });
      torrent.on("error", () => record("torrent attempt error"));
      // infoHash parses locally from the magnet — no swarm round trip — so
      // explicit peers (tests, manual peer hints) attach before metadata.
      const attachPeers = () => {
        for (const peer of opts.peers ?? []) torrent.addPeer(peer);
      };
      torrent.on("infoHash", attachPeers);
      try {
        await waitForMetadata(torrent, METADATA_TIMEOUT_MS, schedule, opts.signal);
      } catch (error) {
        torrent.destroy();
        throw error instanceof Error ? error : new Error(String(error));
      } finally {
        torrent.off("infoHash", attachPeers);
      }
      return torrent;
    },

    async awaitFileHead(torrent, options = {}) {
      const startedAt = Date.now();
      await waitForMetadata(
        torrent,
        options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS,
        schedule,
        options.signal,
      );
      const file = pickVideoFile([...torrent.files]);
      if (!file) {
        throw new Error("torrent carries no playable video file");
      }
      // Sequential intent: the picked file leads, everything else waits. The
      // wire still fetches rarest-first underneath, but selection pressure
      // keeps the head of the chosen file first.
      for (const other of torrent.files) {
        if (other !== file) other.deselect();
      }
      file.select();
      const readiness = new AbortController();
      const signal = options.signal
        ? AbortSignal.any([options.signal, readiness.signal])
        : readiness.signal;
      const cancelDeadline = schedule(
        () => readiness.abort(new Error("torrent readiness timed out")),
        options.readinessTimeoutMs ?? READINESS_TIMEOUT_MS,
      );
      try {
        for (;;) {
          signal.throwIfAborted();
          const head = await this.readContiguousHead(file, HEAD_PROBE_BYTES, signal);
          const assessment = assessTorrentReadiness(head, file.length);
          if (assessment.ready) {
            record("torrent ready", {
              file: file.name,
              container: assessment.container,
              reason: assessment.reason,
              readyMs: Date.now() - startedAt,
              peers: torrent.numPeers,
            });
            return { file, assessment: assessment.reason };
          }
          options.onProgress?.({ downloaded: torrent.downloaded, peers: torrent.numPeers });
          await delay(HEAD_POLL_MS, schedule, signal);
        }
      } finally {
        cancelDeadline();
      }
    },

    progress(torrent) {
      return {
        downloaded: torrent.downloaded,
        speed: torrent.downloadSpeed,
        peers: torrent.numPeers,
      };
    },

    async readContiguousHead(file, byteCount, signal) {
      const end = Math.min(byteCount, file.length) - 1;
      if (end < 0) return new Uint8Array(0);
      const chunks: Uint8Array[] = [];
      let received = 0;
      const target = end + 1;
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new Error("torrent cancelled"));
          return;
        }
        const stream = file.createReadStream({ start: 0, end });
        const onAbort = () => {
          const reason =
            signal?.reason instanceof Error ? signal.reason : new Error("torrent cancelled");
          stream.destroy(reason);
          reject(reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        (async () => {
          try {
            // webtorrent streamx reads yield Buffers, a Uint8Array subclass.
            for await (const chunk of stream) {
              chunks.push(chunk);
              received += chunk.length;
              if (received >= target) break;
            }
            cleanup();
            resolve();
          } catch (error) {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      });
      const out = new Uint8Array(Math.min(received, target));
      let offset = 0;
      for (const chunk of chunks) {
        const take = Math.min(chunk.length, out.length - offset);
        out.set(chunk.subarray(0, take), offset);
        offset += take;
        if (offset >= out.length) break;
      }
      return out;
    },

    destroyTorrent(torrent) {
      torrent.destroy();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      const pending = clientPromise;
      clientPromise = null;
      void pending?.then((instance) => instance.destroy()).catch(() => undefined);
    },
  };
}
