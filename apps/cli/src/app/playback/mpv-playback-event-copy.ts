import {
  classifyPlaybackFailureFromEvent,
  recoveryForPlaybackFailure,
} from "@/infra/player/playback-failure-classifier";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";

export type MpvPlaybackFeedback = {
  readonly detail?: string | null;
  readonly note?: string | null;
};

/**
 * Reconnect `detail` is the internal trigger enum on started/complete and
 * `"<trigger>: <error>"` on failure — translate the enum half, keep errors raw.
 */
function reconnectDetailLabel(detail: string): string {
  const [trigger, rest] = detail.split(": ", 2);
  const label =
    trigger === "network-read-dead"
      ? "network read idle"
      : trigger === "cache-starved"
        ? "buffer stopped filling"
        : trigger === "premature-eof"
          ? "stream ended early"
          : trigger === "error"
            ? "playback error"
            : null;
  if (!label) return detail;
  return rest ? `${label}: ${rest}` : label;
}

/** User-facing copy for mpv playback events (extracted from PlaybackPhase). */
export function describeMpvPlayerEvent(event: PlayerPlaybackEvent): MpvPlaybackFeedback {
  switch (event.type) {
    case "media-materialized":
      return {
        detail:
          event.kind === "dash-mpd"
            ? "Preparing DASH media"
            : event.kind === "hls-manifest"
              ? "Preparing HLS playlist for mpv"
              : "Preparing media",
      };
    case "launching-player":
      return { detail: "Launching player" };
    case "mpv-process-started":
      return { detail: "mpv launched" };
    case "ipc-connected":
      return { detail: "Player control connected" };
    case "ipc-command-failed":
      return {
        note: `Player command failed: ${event.command} (${event.error})`,
      };
    case "ipc-stalled":
      return {
        detail: "Player control stalled",
        note: `mpv did not answer ${event.command}; playback may still be alive`,
      };
    case "opening-stream":
      return { detail: "Opening provider stream" };
    case "resolving-playback":
      return { detail: "Resolving playback" };
    case "network-buffering": {
      const cacheAhead =
        typeof event.cacheAheadSeconds === "number"
          ? `${event.cacheAheadSeconds.toFixed(1)}s cached ahead`
          : null;
      const percent = typeof event.percent === "number" ? `${Math.round(event.percent)}%` : null;
      const status = [percent, cacheAhead].filter(Boolean).join(" / ") || "Filling demuxer cache";
      return {
        detail: "Building playback buffer",
        note: `${status}`,
      };
    }
    case "network-sample":
      return {};
    case "stream-slow":
      if (event.state === "slow-open") {
        return {
          detail: "Still opening the stream",
          note: `${event.secondsBuffering}s · slow sources can take ~30s · auto failover if it stalls out`,
        };
      }
      return {
        detail:
          event.state === "slow-network-suspected"
            ? "Slow source (network read)"
            : "Building playback buffer",
        note: `${event.secondsBuffering}s buffering`,
      };
    case "subtitle-inventory-ready":
      return {
        detail: "Attaching subtitles",
        note:
          event.trackCount > 0
            ? `${event.trackCount} alternate subtitle tracks are ready in mpv`
            : "Primary subtitle is ready",
      };
    case "subtitle-attached":
      return {
        note:
          event.trackCount > 0
            ? `${event.trackCount} subtitle tracks attached`
            : "Primary subtitle attached",
      };
    case "late-subtitles-attached":
      return {
        note: `${event.trackCount} late subtitle ${event.trackCount === 1 ? "track" : "tracks"} attached`,
      };
    case "player-ready":
      return { detail: "Player controls ready" };
    case "playback-started":
      return { detail: "Playing" };
    case "stream-stalled": {
      const dead = event.stallKind === "network-read-dead";
      const starved = event.stallKind === "cache-starved";
      const cause = dead
        ? "Demuxer underrun with no incoming bytes"
        : starved
          ? "Cache stopped filling"
          : `No playback progress for ${event.secondsWithoutProgress}s`;
      return {
        detail: dead
          ? "Stream stalled (network read idle)"
          : starved
            ? "Stream stalled (buffer stopped filling)"
            : "Stream stalled",
        note: `${cause} · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
      };
    }
    case "seek-stalled":
      return {
        detail: "Seek stalled",
        note: `mpv has been seeking for ${event.secondsSeeking}s · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
      };
    case "player-closing":
      return { detail: "Closing player" };
    case "player-closed":
      return { detail: "Player closed" };
    case "segment-skipped":
      return {
        note: `${event.kind.charAt(0).toUpperCase()}${event.kind.slice(1)} ${event.automatic ? "skipped automatically" : "skipped"}`,
      };
    case "track-changed":
      return {
        note: `${event.trackType === "audio" ? "Audio" : "Subtitle"} track switched in mpv (id ${event.id})`,
      };
    case "mpv-in-process-reconnect": {
      const phaseLabel =
        event.phase === "started"
          ? "Reloading same stream in mpv"
          : event.phase === "complete"
            ? "Reload finished"
            : "Reload failed";
      const detail = event.detail ? reconnectDetailLabel(event.detail) : null;
      return {
        detail: phaseLabel,
        note: detail ? `Attempt ${event.attempt} · ${detail}` : `Attempt ${event.attempt}`,
      };
    }
  }
  return {};
}
