import {
  formatSessionLaneLabel,
  formatSessionProviderLabel,
} from "@/domain/session/session-display";
import type { SessionState } from "@/domain/session/SessionState";

import type { ShellStatusTone } from "./types";

type ProviderNameLookup = {
  readonly get: (
    providerId: string,
  ) => { readonly metadata: { readonly name?: string } } | null | undefined;
};

export type RootStatusAlert = {
  text: string;
  tone: ShellStatusTone;
};

export type RootStatusSummary = {
  header: {
    label: string;
    tone: ShellStatusTone;
  };
  /** Compact context crumb: "series · videasy" (playback keeps title/episode in the body) */
  crumb: string;
  /** Highest-priority transient alert, or null when idle */
  alert: RootStatusAlert | null;
};

export type SyncHealth = "ok" | "warn" | "error" | "disconnected";

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

function headerTone(rootStatus: string): ShellStatusTone {
  if (rootStatus === "error") return "error";
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
  offlineMode = false,
  networkAvailable = true,
  playbackIsLocal = false,
  providerRegistry,
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
  offlineMode?: boolean;
  networkAvailable?: boolean;
  playbackIsLocal?: boolean;
  providerRegistry?: ProviderNameLookup;
}): RootStatusSummary {
  const isActivePlayback =
    rootStatus === "playing" ||
    rootStatus === "buffering" ||
    rootStatus === "stalled" ||
    rootStatus === "seeking" ||
    rootStatus === "paused";

  const headerLabel = humanReadableRootStatus(rootStatus);

  // Crumb: show the provider actually serving the active stream when it differs from the
  // session selection (for example after recovery fallback or stale shell state).
  const streamProviderId = state.stream?.providerResolveResult?.providerId;
  const providerCrumb = (() => {
    if (isActivePlayback && streamProviderId && streamProviderId !== state.provider) {
      const selected = formatSessionProviderLabel(
        state.mode,
        state.provider,
        providerRegistry?.get(state.provider)?.metadata.name,
      );
      const active = formatSessionProviderLabel(
        state.mode,
        streamProviderId,
        providerRegistry?.get(streamProviderId)?.metadata.name,
      );
      return `${selected}→${active}`;
    }
    return formatSessionProviderLabel(
      state.mode,
      state.provider,
      providerRegistry?.get(state.provider)?.metadata.name,
    );
  })();

  // Crumb: stable session context only. Title/episode live in the Now Playing body;
  // subtitle state lives in the NOW row — avoid repeating facts in the header strip.
  const crumbParts: string[] = [];
  if (offlineMode) {
    crumbParts.push("offline mode");
  } else if (!networkAvailable) {
    crumbParts.push("no network");
  }
  if (isActivePlayback && playbackIsLocal) {
    crumbParts.push("↓ offline");
  } else {
    crumbParts.push(formatSessionLaneLabel(state.mode), providerCrumb);
  }
  if (!isActivePlayback) {
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
      crumbParts.push(`${playlistCount} up next`);
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
  } else if (offlineMode && !isActivePlayback) {
    alert = { text: "offline mode · library only", tone: "info" };
  } else if (!networkAvailable && !offlineMode && !isActivePlayback) {
    alert = { text: "network unavailable · local copies preferred", tone: "warning" };
  }
  // Standing notification count is NOT an alert — the alert slot is reserved for
  // transient alarms (playback problem, autoplay paused, download progress).
  // The 🔔 bell in the crumb already carries the count, and /notifications opens
  // them; surfacing a persistent "N notifications · /notifications" line here
  // just duplicated the bell and never went away.

  return {
    header: {
      label: headerLabel,
      tone: headerTone(rootStatus),
    },
    crumb,
    alert,
  };
}
