import type { Container } from "@/container";
import type { StreamInfo } from "@/domain/types";
import { gatewayContentType, startLocalMediaGateway } from "@/infra/player/local-media-gateway";
import { createRealDebridPort } from "@/services/debrid/realdebrid";
import { createTorrentEngine } from "@/services/torrent/torrent-engine";
import parseTorrent from "parse-torrent";

export type TorrentPlaybackContext = {
  readonly config: Pick<Container["config"], "debridApiKey">;
  readonly stateManager: Pick<Container["stateManager"], "dispatch">;
  readonly diagnosticsService: Pick<Container["diagnosticsService"], "record">;
  readonly player: Pick<Container["player"], "play">;
};

export type TorrentPlaybackDeps = {
  readonly createEngine?: typeof createTorrentEngine;
  readonly createGateway?: typeof startLocalMediaGateway;
  readonly createDebrid?: typeof createRealDebridPort;
};

export type TorrentPlaybackOutcome =
  | { readonly status: "played"; readonly endReason: string }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "cancelled" };

/** True for magnet URIs (infohash hex is accepted too — parse-torrent decides). */
export function isTorrentMagnetLink(query: string): boolean {
  return query.trim().toLowerCase().startsWith("magnet:");
}

export type TorrentDiagnosticContext = {
  readonly reason?: string;
  readonly file?: string;
  readonly assessment?: string;
  readonly peers?: number;
  readonly message?: string;
  readonly infoHash?: string;
};

function feedback(container: TorrentPlaybackContext, note: string): void {
  container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
}

function diagnose(
  container: TorrentPlaybackContext,
  operation: string,
  message: string,
  context: TorrentDiagnosticContext,
): void {
  container.diagnosticsService.record({
    category: "provider",
    operation,
    message,
    context,
  });
}

/**
 * Stremio-style instant play for a magnet link: swarm metadata → largest
 * video file → readiness gate (container header proven before mpv) → local
 * gateway URL → mpv. The engine seeds while watching and everything is torn
 * down when playback ends.
 *
 * v1 limits (documented, not silent): no resume/history/post-play integration
 * — those ride PlaybackPhase, which this path deliberately bypasses — and no
 * external subtitle lookup (embedded tracks only, via mpv).
 */
export async function playTorrentMagnet(
  container: TorrentPlaybackContext,
  magnet: string,
  options: { readonly signal?: AbortSignal } = {},
  deps: TorrentPlaybackDeps = {},
): Promise<TorrentPlaybackOutcome> {
  const { signal } = options;
  if (signal?.aborted) return { status: "cancelled" };
  let infoHash = "";
  try {
    const parsed = await parseTorrent(magnet.trim());
    infoHash = parsed.infoHash;
  } catch {
    return { status: "failed", message: "That magnet link did not parse." };
  }
  if (!infoHash) return { status: "failed", message: "That magnet link did not parse." };

  const engine = (deps.createEngine ?? createTorrentEngine)({
    onEvent: (event) =>
      container.diagnosticsService.record({
        ...event,
        context: { ...event.context, infoHash: infoHash.slice(0, 12) },
      }),
  });
  const gateway = (deps.createGateway ?? startLocalMediaGateway)({
    onStopped: (reason) =>
      diagnose(container, "torrent.gateway.stopped", "Torrent gateway stopped", { reason }),
  });

  let released = false;
  const cleanup = (reason: "playback-end" | "session-release") => {
    if (released) return;
    released = true;
    gateway.stop(reason);
    engine.destroy();
  };

  try {
    feedback(container, "Joining the swarm — fetching torrent metadata…");
    const torrent = await engine.addMagnet(magnet.trim(), { signal });
    feedback(container, "Waiting for a playable file head (peers joining)…");
    let fileName = "stream";
    let mountUrl: string;
    try {
      const { file, assessment } = await engine.awaitFileHead(torrent, {
        signal,
        onProgress: (progress) => {
          if (progress.peers === 0) {
            feedback(container, "Waiting for peers — check your connection…");
          } else {
            feedback(
              container,
              `Buffering from ${progress.peers} peer${progress.peers === 1 ? "" : "s"}…`,
            );
          }
        },
      });
      fileName = file.name;
      diagnose(container, "torrent.ready", "Torrent head ready", {
        file: file.name,
        assessment,
        peers: torrent.numPeers,
      });
      const mountId = infoHash.slice(0, 16);
      mountUrl = gateway.mountTorrentFile({
        mountId,
        fileName: file.name,
        fileLength: file.length,
        contentType: gatewayContentType(file.name),
        readRange: (start, end, rangeSignal) => {
          const stream = file.createReadStream({ start, end });
          rangeSignal.addEventListener("abort", () => stream.destroy(new Error("closed")), {
            once: true,
          });
          return stream;
        },
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      // Local swarm failed — the experimental debrid lane gets one chance
      // when the user configured a token, then the attempt ends honestly.
      const token = container.config.debridApiKey.trim();
      if (!token) throw error;
      feedback(container, "Swarm stalled — trying debrid unrestrict (experimental)…");
      diagnose(container, "torrent.debrid.fallback", "Falling back to debrid", {});
      try {
        const directUrl = await (deps.createDebrid ?? createRealDebridPort)(token).unrestrict(
          magnet.trim(),
          signal,
        );
        return await playDirectUrl(container, directUrl, fileName, cleanup, signal);
      } catch (debridError) {
        throw debridError instanceof Error ? debridError : error;
      }
    }

    return await playDirectUrl(container, mountUrl, fileName, cleanup, signal);
  } catch (error) {
    if (signal?.aborted) return { status: "cancelled" };
    const message = error instanceof Error ? error.message : String(error);
    feedback(container, `Torrent failed: ${message}`);
    diagnose(container, "torrent.failed", "Torrent playback failed", { message });
    return { status: "failed", message };
  } finally {
    cleanup("session-release");
  }
}

async function playDirectUrl(
  container: TorrentPlaybackContext,
  url: string,
  fileName: string,
  cleanup: (reason: "playback-end" | "session-release") => void,
  signal?: AbortSignal,
): Promise<TorrentPlaybackOutcome> {
  const stream: StreamInfo = {
    url,
    headers: {},
    title: fileName,
    timestamp: Date.now(),
  };
  feedback(container, `Playing ${fileName} — seeding while watching.`);
  try {
    const result = await container.player.play(stream, {
      url,
      displayTitle: fileName,
      playbackMode: "manual",
      abortSignal: signal,
    });
    return { status: "played", endReason: result.endReason };
  } finally {
    cleanup("playback-end");
  }
}
