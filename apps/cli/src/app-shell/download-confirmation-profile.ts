// =============================================================================
// download-confirmation-profile.ts — pure edit policy for a download
// confirmation draft.
//
// Kept separate from both the phase and the shell so either can import it
// without creating a shell↔phase cycle. It owns only "what does this edit do to
// the draft"; mounting, rendering and committing live elsewhere.
// =============================================================================

import { AUDIO_SETTINGS_OPTIONS } from "@/app-shell/settings/registry/shared";
import type { DownloadConfirmationProfile } from "@/services/download/DownloadIntentService";

export type DownloadConfirmationEditAction =
  | "cycle-audio"
  | "cycle-subtitle"
  | "cycle-quality"
  | "toggle-artwork"
  | "toggle-destination"
  | "increase-runway"
  | "decrease-runway"
  | "toggle-cleanup";

const SUBTITLE_OPTIONS = ["en", "none", "interactive"] as const;
const QUALITY_OPTIONS = ["best", "1080p", "720p"] as const;

function cycle(options: readonly string[], current: string | undefined, fallback: string): string {
  const index = Math.max(0, options.indexOf(current ?? fallback));
  return options[(index + 1) % options.length] ?? fallback;
}

export function updateDownloadConfirmationProfile(
  profile: DownloadConfirmationProfile,
  action: DownloadConfirmationEditAction,
  configuredOutputDirectory?: string,
  configuredCleanupGraceDays = 7,
): DownloadConfirmationProfile {
  if (action === "cycle-audio") {
    // Reuse the settings vocabulary rather than duplicating language values —
    // a confirmation that offers audio the settings screen does not know about
    // cannot be persisted as a preference later.
    return {
      ...profile,
      audioPreference: cycle(
        AUDIO_SETTINGS_OPTIONS.map((option) => option.value),
        profile.audioPreference,
        "original",
      ),
    };
  }
  if (action === "cycle-subtitle") {
    return {
      ...profile,
      subtitlePreference: cycle(SUBTITLE_OPTIONS, profile.subtitlePreference, "en"),
    };
  }
  if (action === "cycle-quality") {
    return {
      ...profile,
      qualityPreference: cycle(QUALITY_OPTIONS, profile.qualityPreference, "best"),
    };
  }
  if (action === "toggle-artwork") return { ...profile, cacheArtwork: !profile.cacheArtwork };
  if (action === "toggle-destination") {
    return {
      ...profile,
      outputDirectory: profile.outputDirectory ? undefined : configuredOutputDirectory || undefined,
    };
  }
  if (action === "increase-runway") {
    return { ...profile, runwayTarget: Math.min(10, (profile.runwayTarget ?? 1) + 1) };
  }
  if (action === "decrease-runway") {
    return { ...profile, runwayTarget: Math.max(1, (profile.runwayTarget ?? 1) - 1) };
  }
  return {
    ...profile,
    cleanupPolicy:
      profile.cleanupPolicy.mode === "cleanup-watched"
        ? { mode: "keep-last-watched", count: 1 }
        : { mode: "cleanup-watched", graceDays: configuredCleanupGraceDays },
  };
}
