import {
  compactPlaybackSubtitleStatus,
  describePlaybackSubtitleStatus,
  playbackSubtitleStatusTone,
} from "@/app/subtitle-status";
import type { SessionState } from "@/domain/session/SessionState";

import type { ShellStatusTone } from "./types";

export type RootStatusAlert = {
  text: string;
  tone: ShellStatusTone;
};

export type RootStatusSummary = {
  header: {
    label: string;
    tone: ShellStatusTone;
  };
  /** Compact context crumb: "series · vidking" or "series · vidking · Title · S01E04" */
  crumb: string;
  /** Highest-priority transient alert, or null when idle */
  alert: RootStatusAlert | null;
};

export type SyncHealth = "ok" | "warn" | "error" | "disconnected";

function formatEpisode(state: SessionState): string | null {
  if (!state.currentEpisode) return null;
  return `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
    state.currentEpisode.episode,
  ).padStart(2, "0")}`;
}

function humanReadableRootStatus(raw: string): string {
  switch (raw) {
    case "playing":
      return "Playing";
    case "buffering":
      return "Buffering…";
    case "stalled":
      return "Stream stalled";
    case "seeking":
      return "Seeking…";
    case "loading":
      return "Loading…";
    case "error":
      return "Playback error";
    case "idle":
      return "ready";
    case "resolving":
      return "Resolving…";
    case "paused":
      return "Paused";
    default:
      return raw;
  }
}

function headerTone(rootStatus: string, subtitleTone: ShellStatusTone | null): ShellStatusTone {
  if (rootStatus === "error") return "error";
  if (subtitleTone === "warning") return "warning";
  if (rootStatus === "playing" || rootStatus === "ready" || rootStatus === "idle") return "success";
  if (
    rootStatus === "searching" ||
    rootStatus === "loading" ||
    rootStatus === "buffering" ||
    rootStatus === "seeking" ||
    rootStatus === "resolving" ||
    rootStatus === "stalled"
  )
    return "warning";
  return "neutral";
}

export function buildRootStatusSummary({
  state,
  currentViewLabel: _currentViewLabel,
  rootStatus,
  downloadStatus,
  streak,
  syncHealth,
}: {
  state: SessionState;
  currentViewLabel: string;
  rootStatus: string;
  downloadStatus?: string | null;
  streak?: number;
  syncHealth?: SyncHealth;
}): RootStatusSummary {
  const episode = formatEpisode(state);
  const title = state.currentTitle?.name;
  const isActivePlayback =
    rootStatus === "playing" ||
    rootStatus === "buffering" ||
    rootStatus === "stalled" ||
    rootStatus === "seeking" ||
    rootStatus === "paused";

  const subtitleStatus =
    state.stream || isActivePlayback
      ? describePlaybackSubtitleStatus(
          state.stream,
          state.mode === "anime"
            ? state.animeLanguageProfile.subtitle
            : state.seriesLanguageProfile.subtitle,
        )
      : null;
  const subtitleTone = subtitleStatus ? playbackSubtitleStatusTone(subtitleStatus) : null;
  const subtitleCompact = subtitleStatus ? compactPlaybackSubtitleStatus(subtitleStatus) : null;

  const headerLabel =
    isActivePlayback && subtitleCompact
      ? `${humanReadableRootStatus(rootStatus)} · ${subtitleCompact}`
      : humanReadableRootStatus(rootStatus);

  // Crumb: always mode · provider; add title + episode during playback,
  // or streak + sync health when idle
  const crumbParts: string[] = [state.mode, state.provider];
  if (isActivePlayback && title) {
    crumbParts.push(title);
    if (episode) crumbParts.push(episode);
    if (subtitleCompact) crumbParts.push(subtitleCompact);
  } else {
    if (streak !== undefined && streak >= 2) {
      crumbParts.push(`🔥 ${streak}d`);
    }
    if (syncHealth === "ok") {
      crumbParts.push("sync✓");
    } else if (syncHealth === "warn") {
      crumbParts.push("sync⚠");
    } else if (syncHealth === "error") {
      crumbParts.push("sync✗");
    }
  }
  const crumb = crumbParts.join(" · ");

  // Alert: highest-priority transient signal, null when nothing is active
  let alert: RootStatusAlert | null = null;
  if (state.playbackProblem) {
    alert = {
      text: `⚠ issue · ${state.playbackProblem.cause}`,
      tone: state.playbackProblem.severity === "blocking" ? "error" : "warning",
    };
  } else if (state.autoplaySessionPaused) {
    alert = { text: "⚠ autoplay paused", tone: "warning" };
  } else if (state.autoskipSessionPaused) {
    alert = { text: "⚠ autoskip paused", tone: "warning" };
  } else if (state.stopAfterCurrent) {
    alert = { text: "⚠ stop after current", tone: "warning" };
  } else if (downloadStatus) {
    alert = { text: `⬇ ${downloadStatus}`, tone: "info" };
  }

  return {
    header: {
      label: headerLabel,
      tone: headerTone(rootStatus, subtitleTone),
    },
    crumb,
    alert,
  };
}
