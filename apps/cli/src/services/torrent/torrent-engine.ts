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
    opts?: { readonly peers?: readonly string[] },
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

function waitFor(
  register: (done: () => void) => void,
  timeoutMs: number,
  what: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("torrent cancelled before start"));
      return;
    }
    const timer = setTimeout(() => reject(new Error(`torrent ${what} timed out`)), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("torrent cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    register(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

export function createTorrentEngine(events: TorrentEngineEvents = {}): TorrentEngine {
  // One client per engine: DHT, trackers, and LSD fan out per torrent, and a
  // shared client would let one stalled magnet hold the swarm ports of others.
  // The client is created lazily on first use so importing this module costs
  // nothing for non-torrent sessions.
  let clientPromise: Promise<import("webtorrent").default> | null = null;
  const client = (): Promise<import("webtorrent").default> => {
    clientPromise ??= loadWebTorrent().then(
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
    );
    return clientPromise;
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
    async addMagnet(magnet: string, opts: { peers?: readonly string[] } = {}) {
      const instance = await client();
      const torrent = instance.add(magnet, { destroyStoreOnDestroy: true });
      // infoHash parses locally from the magnet — no swarm round trip — so
      // explicit peers (tests, manual peer hints) attach before metadata.
      torrent.on("infoHash", () => {
        for (const peer of opts.peers ?? []) torrent.addPeer(peer);
      });
      try {
        // Engine errors surface as failed reads or the timeout below — the
        // attach itself only waits for metadata readiness.
        await waitFor(
          (done) => {
            torrent.on("ready", done);
            torrent.on("metadata", done);
          },
          METADATA_TIMEOUT_MS,
          "metadata attach",
        );
      } catch (error) {
        torrent.destroy();
        throw error instanceof Error ? error : new Error(String(error));
      }
      return torrent;
    },

    async awaitFileHead(torrent, options = {}) {
      const startedAt = Date.now();
      await waitFor(
        (done) => {
          if (torrent.ready) done();
          else {
            torrent.on("ready", done);
            torrent.on("metadata", done);
          }
        },
        options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS,
        "metadata",
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
      const deadline = Date.now() + (options.readinessTimeoutMs ?? READINESS_TIMEOUT_MS);
      for (;;) {
        if (options.signal?.aborted) throw new Error("torrent cancelled");
        const head = await this.readContiguousHead(file, HEAD_PROBE_BYTES, options.signal);
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
        if (Date.now() >= deadline) {
          throw new Error(`torrent not ready: ${assessment.reason}`);
        }
        options.onProgress?.({ downloaded: torrent.downloaded, peers: torrent.numPeers });
        await new Promise((resolve) => setTimeout(resolve, HEAD_POLL_MS));
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
          reject(new Error("torrent cancelled"));
          return;
        }
        const stream = file.createReadStream({ start: 0, end });
        const onAbort = () => {
          stream.destroy(new Error("torrent cancelled"));
          reject(new Error("torrent cancelled"));
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
      const pending = clientPromise;
      clientPromise = null;
      void pending?.then((instance) => instance.destroy()).catch(() => undefined);
    },
  };
}
