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

  if (subLang === "fzf") {
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

  // Provider already resolved a subtitle — use it as the default.
  if (stream.subtitle) {
    return {
      subtitle: stream.subtitle,
      reason: "provider-default",
      availableTracks: stream.subtitleList?.length ?? 0,
    };
  }

  // No pre-selected subtitle, but tracks are available — auto-select using the
  // same language-matching logic used in the scraper. This covers the case where
  // BrowserServiceImpl resolved the full list but couldn't pick a track, or where
  // the cached stream has a list but the previous selection didn't persist.
  if (stream.subtitleList?.length) {
    const tracks = stream.subtitleList as unknown as SubtitleEntry[];
    const pick = selectSubtitle(tracks, subLang);
    return {
      subtitle: pick?.url ?? null,
      reason: pick ? "auto-selected" : "no-tracks",
      availableTracks: stream.subtitleList.length,
    };
  }

  return {
    subtitle: null,
    reason: "no-tracks",
    availableTracks: 0,
  };
}
