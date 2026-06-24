import type { EpisodeInfo } from "@/domain/types";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";

export async function applyMpvEpisodeLoadingOverlay(
  control: ActivePlayerControl | null,
  episode: EpisodeInfo,
): Promise<void> {
  if (!control) return;
  const label = `Kunai · Loading S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}…`;
  if (control.setEpisodeTransitionLoading) {
    await control.setEpisodeTransitionLoading(label);
  } else {
    await control.showOsdMessage?.(label, 120_000);
  }
}

export async function applyMpvStreamSwitchOverlay(
  control: ActivePlayerControl | null,
  detail = "Switching source…",
): Promise<void> {
  if (!control) return;
  const label = `Kunai · ${detail}`;
  if (control.setEpisodeTransitionLoading) {
    await control.setEpisodeTransitionLoading(label);
  } else {
    await control.showOsdMessage?.(label, 120_000);
  }
}
