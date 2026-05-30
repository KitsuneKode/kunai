import {
  compactPlaybackSubtitleStatus,
  describePlaybackSubtitleStatus,
  playbackSubtitleStatusTone,
} from "@/app/subtitle-status";
import type { SessionState } from "@/domain/session/SessionState";

import { mediaLanguageProfileFor, resolveContentKind, showsEpisodeLabel } from "./content-kind";
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
  playlistCount,
  notificationCount,
  newEpisodeNotificationCount,
}: {
  state: SessionState;
  currentViewLabel: string;
  rootStatus: string;
  downloadStatus?: string | null;
  streak?: number;
  syncHealth?: SyncHealth;
  playlistCount?: number;
  notificationCount?: number;
  newEpisodeNotificationCount?: number;
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
      ? describePlaybackSubtitleStatus(state.stream, mediaLanguageProfileFor(state).subtitle)
      : null;
  const subtitleTone = subtitleStatus ? playbackSubtitleStatusTone(subtitleStatus) : null;
  const subtitleCompact = subtitleStatus ? compactPlaybackSubtitleStatus(subtitleStatus) : null;

  const headerLabel =
    isActivePlayback && subtitleCompact
      ? `${humanReadableRootStatus(rootStatus)} · ${subtitleCompact}`
      : humanReadableRootStatus(rootStatus);

  // Crumb: show the provider actually serving the active stream when it differs from the
  // session selection (for example after recovery fallback or stale shell state).
  const streamProviderId = state.stream?.providerResolveResult?.providerId;
  const providerCrumb =
    isActivePlayback && streamProviderId && streamProviderId !== state.provider
      ? `${state.provider}→${streamProviderId}`
      : state.provider;

  // Crumb: always mode · provider; add title + episode during playback,
  // or streak + sync health when idle
  const crumbParts: string[] = [resolveContentKind(state.currentTitle, state.mode), providerCrumb];
  if (isActivePlayback && title) {
    crumbParts.push(title);
    if (episode && showsEpisodeLabel(state.currentTitle)) crumbParts.push(episode);
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
    if (playlistCount !== undefined && playlistCount > 0) {
      crumbParts.push(`${playlistCount} queued`);
    }
    if (notificationCount !== undefined && notificationCount > 0) {
      crumbParts.push(
        newEpisodeNotificationCount !== undefined && newEpisodeNotificationCount > 0
          ? `🔔 ${newEpisodeNotificationCount} new`
          : `🔔 ${notificationCount}`,
      );
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
  // Standing notification count is NOT an alert — the alert slot is reserved for
  // transient alarms (playback problem, autoplay paused, download progress).
  // The 🔔 bell in the crumb already carries the count, and /notifications opens
  // them; surfacing a persistent "N notifications · /notifications" line here
  // just duplicated the bell and never went away.

  return {
    header: {
      label: headerLabel,
      tone: headerTone(rootStatus, subtitleTone),
    },
    crumb,
    alert,
  };
}
