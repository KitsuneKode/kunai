import type { Container } from "@/container";
import { shouldPersistHistory, toHistoryTimestamp } from "@/domain/playback/playback-history";
import { shouldMarkEpisodeCompleted } from "@/domain/playback/playback-policy";
import { PERSIST_RESUME_SECONDS } from "@/domain/playback/progress-engage-policy";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import { gatewayContentType, startLocalMediaGateway } from "@/infra/player/local-media-gateway";
import type { PlayerOptions } from "@/infra/player/PlayerService";
import { createRealDebridPort } from "@/services/debrid/realdebrid";
import { createTorrentEngine } from "@/services/torrent/torrent-engine";
import type { TitleIdentity } from "@kunai/types";
import parseTorrent from "parse-torrent";

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

function feedback(container: Container, note: string): void {
  container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
}

/** History identity for a swarm file: the infohash is the only stable key. */
function torrentHistoryTitle(infoHash: string, fileName: string): TitleIdentity {
  return { id: `torrent:${infoHash}`, kind: "movie", title: fileName };
}

/** Resume point for a replay, or undefined to start over. Never blocks play. */
export function readTorrentResumeSeconds(
  container: Container,
  title: TitleIdentity,
): number | undefined {
  try {
    const existing = container.historyRepository.getProgress(title, undefined);
    if (existing && !existing.completed && existing.positionSeconds > PERSIST_RESUME_SECONDS) {
      return existing.positionSeconds;
    }
  } catch (error) {
    diagnose(container, "torrent.history.read-failed", "Torrent resume lookup failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return undefined;
}

/** Checkpoint an engaged watch under the torrent identity. Never blocks teardown. */
export function writeTorrentHistory(
  container: Container,
  title: TitleIdentity,
  result: PlaybackResult,
): void {
  if (!shouldPersistHistory(result)) return;
  const completed = shouldMarkEpisodeCompleted(result);
  const positionSeconds = toHistoryTimestamp(result);
  const now = new Date().toISOString();
  try {
    container.historyRepository.upsertProgress({
      title,
      episode: undefined,
      positionSeconds,
      durationSeconds: result.duration,
      completed,
      watchedSeconds: completed ? result.duration : positionSeconds,
      lastWatchedAt: now,
      completedAt: completed ? now : null,
      updatedAt: now,
    });
  } catch (error) {
    diagnose(container, "torrent.history.write-failed", "Torrent history write failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function diagnose(
  container: Container,
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
 * History and resume ride the same policy as catalog playback
 * (`shouldPersistHistory` / `toHistoryTimestamp` /
 * `shouldMarkEpisodeCompleted`): an engaged watch checkpoints under
 * `torrent:<infohash>` and a replay resumes past it, while only a clean
 * natural EOF clears the resume point. v1 limits (documented, not silent):
 * no post-play integration — that rides PlaybackPhase, which this path
 * deliberately bypasses — and no external subtitle lookup (embedded tracks
 * only, via mpv).
 */
export async function playTorrentMagnet(
  container: Container,
  magnet: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<TorrentPlaybackOutcome> {
  const { signal } = options;
  let infoHash = "";
  try {
    const parsed = await parseTorrent(magnet.trim());
    infoHash = parsed.infoHash;
  } catch {
    return { status: "failed", message: "That magnet link did not parse." };
  }
  if (!infoHash) return { status: "failed", message: "That magnet link did not parse." };

  const engine = createTorrentEngine({
    onEvent: (event) =>
      container.diagnosticsService.record({
        ...event,
        context: { ...event.context, infoHash: infoHash.slice(0, 12) },
      }),
  });
  const gateway = startLocalMediaGateway({
    onStopped: (reason) =>
      diagnose(container, "torrent.gateway.stopped", "Torrent gateway stopped", { reason }),
  });

  const cleanup = (reason: "playback-end" | "session-release") => {
    gateway.stop(reason);
    engine.destroy();
  };

  try {
    feedback(container, "Joining the swarm — fetching torrent metadata…");
    const torrent = await engine.addMagnet(magnet.trim());
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
      // Local swarm failed — the experimental debrid lane gets one chance
      // when the user configured a token, then the attempt ends honestly.
      const token = container.config.debridApiKey.trim();
      if (!token) throw error;
      feedback(container, "Swarm stalled — trying debrid unrestrict (experimental)…");
      diagnose(container, "torrent.debrid.fallback", "Falling back to debrid", {});
      try {
        const directUrl = await createRealDebridPort(token).unrestrict(magnet.trim(), signal);
        return await playDirectUrl(container, directUrl, fileName, infoHash, cleanup, signal);
      } catch (debridError) {
        throw debridError instanceof Error ? debridError : error;
      }
    }

    return await playDirectUrl(container, mountUrl, fileName, infoHash, cleanup, signal);
  } catch (error) {
    if (signal?.aborted) return { status: "cancelled" };
    const message = error instanceof Error ? error.message : String(error);
    feedback(container, `Torrent failed: ${message}`);
    diagnose(container, "torrent.failed", "Torrent playback failed", { message });
    cleanup("session-release");
    return { status: "failed", message };
  }
}

async function playDirectUrl(
  container: Container,
  url: string,
  fileName: string,
  infoHash: string,
  cleanup: (reason: "playback-end" | "session-release") => void,
  signal?: AbortSignal,
): Promise<TorrentPlaybackOutcome> {
  const stream: StreamInfo = {
    url,
    headers: {},
    title: fileName,
    timestamp: Date.now(),
  };
  const historyTitle = torrentHistoryTitle(infoHash, fileName);
  const resumeAt = readTorrentResumeSeconds(container, historyTitle);
  if (resumeAt !== undefined) {
    feedback(container, `Resuming ${fileName} where you left off — seeding while watching.`);
  } else {
    feedback(container, `Playing ${fileName} — seeding while watching.`);
  }
  try {
    const playOptions: PlayerOptions = {
      url,
      displayTitle: fileName,
      playbackMode: "manual",
      abortSignal: signal,
    };
    if (resumeAt !== undefined) playOptions.startAt = resumeAt;
    const result = await container.player.play(stream, playOptions);
    writeTorrentHistory(container, historyTitle, result);
    return { status: "played", endReason: result.endReason };
  } finally {
    cleanup("playback-end");
  }
}
