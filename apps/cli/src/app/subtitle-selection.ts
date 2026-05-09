import { hardSubSatisfiesSubtitlePreference } from "@/domain/subtitle-policy";
import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import { selectSubtitle } from "@/subtitle";
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

export async function choosePlaybackSubtitle({
  stream,
  subLang,
  pickSubtitle,
}: {
  stream: StreamInfo;
  subLang: string;
  pickSubtitle: (tracks: readonly SubtitleTrack[]) => Promise<string | null>;
}): Promise<SubtitleDecision> {
  if (subLang === "none") {
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
    const pick = selectSubtitle(tracks, subLang);
    return {
      subtitle: pick?.url ?? stream.subtitle ?? null,
      reason:
        pick?.url && pick.url === stream.subtitle
          ? "provider-default"
          : pick
            ? "auto-selected"
            : stream.subtitle
              ? "provider-default"
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
