import type { SessionState } from "@/domain/session/SessionState";

import type { ShellStatusTone } from "./types";

export type RootStatusBadge = {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "error";
};

export type RootStatusSummary = {
  header: {
    label: string;
    tone: ShellStatusTone;
  };
  badges: readonly RootStatusBadge[];
};

function formatEpisode(state: SessionState): string | null {
  if (!state.currentEpisode) return null;
  return `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
    state.currentEpisode.episode,
  ).padStart(2, "0")}`;
}

function subtitleBadge(state: SessionState): RootStatusBadge | null {
  if (state.subLang === "none") {
    return { label: "subs off", tone: "warning" };
  }
  if (state.stream?.subtitle) {
    return { label: "subs ready", tone: "success" };
  }
  if (state.stream?.subtitleList?.length) {
    return { label: `${state.stream.subtitleList.length} subs`, tone: "info" };
  }
  if (state.playbackStatus === "playing" || state.playbackStatus === "buffering") {
    return { label: "subs missing", tone: "warning" };
  }
  return null;
}

function headerTone(rootStatus: string, subtitle: RootStatusBadge | null): ShellStatusTone {
  if (rootStatus === "error") return "error";
  if (subtitle?.tone === "warning") return "warning";
  if (rootStatus === "playing" || rootStatus === "ready") return "success";
  return "neutral";
}

export function buildRootStatusSummary({
  state,
  currentViewLabel,
  rootStatus,
}: {
  state: SessionState;
  currentViewLabel: string;
  rootStatus: string;
}): RootStatusSummary {
  const episode = formatEpisode(state);
  const subtitle = subtitleBadge(state);
  const title = state.currentTitle?.name;
  const headerLabel =
    subtitle && (rootStatus === "playing" || rootStatus === "buffering" || rootStatus === "stalled")
      ? `${rootStatus} · ${subtitle.label}`
      : rootStatus;

  const badges: RootStatusBadge[] = [
    { label: state.mode, tone: "info" },
    { label: state.provider, tone: "neutral" },
    { label: currentViewLabel, tone: "success" },
  ];

  if (title) {
    badges.push({ label: title, tone: "neutral" });
  }
  if (episode) {
    badges.push({ label: episode, tone: "neutral" });
  }
  if (subtitle) {
    badges.push(subtitle);
  }
  if (state.playbackProblem) {
    badges.push({
      label: `issue ${state.playbackProblem.cause}`,
      tone: state.playbackProblem.severity === "blocking" ? "error" : "warning",
    });
  }
  if (state.autoplaySessionPaused) {
    badges.push({ label: "autoplay paused", tone: "warning" });
  }
  if (state.stopAfterCurrent) {
    badges.push({ label: "stop after current", tone: "warning" });
  }

  return {
    header: {
      label: headerLabel,
      tone: headerTone(rootStatus, subtitle),
    },
    badges,
  };
}
