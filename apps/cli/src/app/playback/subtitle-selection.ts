import { isSubtitlePreferenceDisabled } from "@/domain/media/media-preferences";
import { hardSubSatisfiesSubtitlePreference } from "@/domain/subtitle-policy";
import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import { langMatches, selectAutomaticSubtitle } from "@/subtitle";
import type { SubtitleEntry } from "@/subtitle";

export type SubtitleDecision = {
  subtitle: string | null;
  reason:
    | "disabled"
    | "provider-default"
    | "auto-selected"
    | "interactive-picked"
    | "interactive-cancelled"
    | "hardsub-satisfied"
    | "no-tracks";
  availableTracks: number;
};

export type LateSubtitleLookupDecision = {
  attempt: boolean;
  reason:
    | "disabled"
    | "tmdb-id-missing"
    | "attached"
    | "inventory-satisfied"
    | "hardsub-satisfied"
    | "needs-lookup";
  availableTracks: number;
};

export function shouldAttemptLateSubtitleLookup({
  stream,
  requestedSubLang,
  hasTmdbId,
}: {
  stream: StreamInfo;
  requestedSubLang: string;
  hasTmdbId: boolean;
}): LateSubtitleLookupDecision {
  const availableTracks = stream.subtitleList?.length ?? 0;
  if (isSubtitlePreferenceDisabled(requestedSubLang)) {
    return { attempt: false, reason: "disabled", availableTracks };
  }
  if (!hasTmdbId) {
    return { attempt: false, reason: "tmdb-id-missing", availableTracks };
  }
  if (hardSubSatisfiesSubtitlePreference(stream, requestedSubLang)) {
    return { attempt: false, reason: "hardsub-satisfied", availableTracks };
  }
  if (stream.subtitle) {
    return { attempt: false, reason: "attached", availableTracks };
  }
  if (availableTracks > 0) {
    const hasRequestedTrack = stream.subtitleList?.some((track) =>
      langMatches(track.language ?? track.display ?? "", requestedSubLang),
    );
    if (hasRequestedTrack) {
      return { attempt: false, reason: "inventory-satisfied", availableTracks };
    }
  }
  return { attempt: true, reason: "needs-lookup", availableTracks };
}

export async function choosePlaybackSubtitle({
  stream,
  subLang,
  pickSubtitle,
}: {
  stream: StreamInfo;
  subLang: string;
  pickSubtitle: (tracks: readonly SubtitleTrack[]) => Promise<string | null>;
}): Promise<SubtitleDecision> {
  if (isSubtitlePreferenceDisabled(subLang)) {
    return {
      subtitle: null,
      reason: "disabled",
      availableTracks: stream.subtitleList?.length ?? 0,
    };
  }

  if (hardSubSatisfiesSubtitlePreference(stream, subLang) && !stream.subtitleList?.length) {
    return {
      subtitle: null,
      reason: "hardsub-satisfied",
      availableTracks: 0,
    };
  }

  if (subLang === "interactive" || subLang === "fzf") {
    if (!stream.subtitleList?.length) {
      return {
        subtitle: stream.subtitle ?? null,
        reason: "no-tracks",
        availableTracks: 0,
      };
    }

    const selected = await pickSubtitle(stream.subtitleList);
    return {
      subtitle: selected,
      reason: selected ? "interactive-picked" : "interactive-cancelled",
      availableTracks: stream.subtitleList.length,
    };
  }

  if (stream.subtitleList?.length) {
    const tracks = stream.subtitleList as unknown as SubtitleEntry[];
    const pick = selectAutomaticSubtitle(tracks, subLang);
    return {
      subtitle: pick?.url ?? null,
      reason:
        pick?.url && pick.url === stream.subtitle
          ? "provider-default"
          : pick
            ? "auto-selected"
            : "no-tracks",
      availableTracks: stream.subtitleList.length,
    };
  }

  // Provider already resolved a subtitle, but we did not receive the full inventory.
  if (stream.subtitle) {
    return {
      subtitle: stream.subtitle,
      reason: "provider-default",
      availableTracks: 0,
    };
  }

  return {
    subtitle: null,
    reason: "no-tracks",
    availableTracks: 0,
  };
}
