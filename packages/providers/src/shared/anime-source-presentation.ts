/**
 * Shared presentation helpers for anime providers (AllManga/AllAnime + Miruro).
 *
 * Goal: one inventory language so the Tracks/source picker feels the same across
 * anime providers — Sub/Dub · Server · subtitle mode — while each provider keeps
 * its own sourceId scheme (AllManga family vs Miruro pipe:server:audio).
 */

import {
  normalizeProviderDisplayLabel,
  normalizeQualityLabel,
  qualityRankFromLabel,
} from "./source-inventory";

export type AnimeAudioCategory = "sub" | "dub";

/** How captions are delivered for this source (UI-facing, short). */
export type AnimeSubtitleMode = "soft" | "hard" | "unknown" | "external";

export type AnimeSourceLabelInput = {
  readonly audio: AnimeAudioCategory;
  /** Human server/family name (Kiwi, Default, FM HLS, …). */
  readonly serverLabel: string;
  readonly subtitleMode?: AnimeSubtitleMode;
};

export type AnimeQualityFields = {
  readonly qualityLabel: string;
  readonly qualityRank: number;
};

/** `Sub · Kiwi · soft sub` / `Dub · Bee · hard sub` / `Sub · Default · hard sub`. */
export function formatAnimeSourceLabel(input: AnimeSourceLabelInput): string {
  const audio = input.audio === "dub" ? "Dub" : "Sub";
  const server = polishAnimeServerLabel(input.serverLabel);
  const mode = formatAnimeSubtitleMode(input.subtitleMode);
  return mode ? `${audio} · ${server} · ${mode}` : `${audio} · ${server}`;
}

/**
 * Hybrid Miruro detail line (character is the primary label): `Sub · hard sub`.
 * Omits the server/character token so Tracks can show it under Gintoki/Kagura.
 */
export function formatAnimeSourceDetail(input: {
  readonly audio: AnimeAudioCategory;
  readonly subtitleMode?: AnimeSubtitleMode;
}): string {
  const audio = input.audio === "dub" ? "Dub" : "Sub";
  const mode = formatAnimeSubtitleMode(input.subtitleMode);
  return mode ? `${audio} · ${mode}` : audio;
}

/**
 * Normalize raw keys (`fm-hls`, `kiwi`) without re-title-casing already human
 * labels (`Kiwi hardsub`, `FM HLS`) that providers polish themselves.
 */
export function polishAnimeServerLabel(serverLabel: string): string {
  const trimmed = serverLabel.trim();
  if (!trimmed) return "Unknown";
  // Already humanized: multi-word, mixed case beyond first char, or known display form.
  if (/\s/.test(trimmed) || /[A-Z]/.test(trimmed.slice(1))) {
    return trimmed;
  }
  return normalizeProviderDisplayLabel(trimmed)?.trim() || trimmed;
}

export function formatAnimeSubtitleMode(mode: AnimeSubtitleMode | undefined): string | undefined {
  switch (mode) {
    case "soft":
    case "external":
      return "soft sub";
    case "hard":
      return "hard sub";
    case "unknown":
      return "subtitles unknown";
    default:
      return undefined;
  }
}

/** Short archetype for flavorArchetype / known-catalog subtitle. */
export function formatAnimeSourceArchetype(input: {
  readonly audio: AnimeAudioCategory;
  readonly detail?: string;
}): string {
  const base = input.audio === "dub" ? "English · dub" : "Japanese · hardsub";
  const detail = input.detail?.trim();
  return detail ? `${detail} · ${input.audio === "dub" ? "dub" : "sub"}` : base;
}

/** Normalize provider quality strings for both anime providers. */
export function animeQualityFields(
  quality: string | number | undefined,
  fallbackHeight?: number,
): AnimeQualityFields {
  const fromLabel = normalizeQualityLabel(quality);
  if (fromLabel && fromLabel !== "unknown" && fromLabel !== "auto") {
    return {
      qualityLabel: fromLabel,
      qualityRank: qualityRankFromLabel(fromLabel) ?? qualityRankFromLabel(quality) ?? 0,
    };
  }
  if (typeof fallbackHeight === "number" && fallbackHeight > 0) {
    return {
      qualityLabel: `${Math.trunc(fallbackHeight)}p`,
      qualityRank: Math.trunc(fallbackHeight),
    };
  }
  if (fromLabel === "auto") {
    return { qualityLabel: "auto", qualityRank: qualityRankFromLabel("auto") ?? 1080 };
  }
  return { qualityLabel: "auto", qualityRank: 0 };
}

/** Map Miruro-style subtitle delivery enums onto the shared mode. */
export function miruroSubtitleDeliveryToMode(
  delivery: "embedded" | "hardcoded" | "unknown" | "external" | undefined,
): AnimeSubtitleMode {
  if (delivery === "embedded" || delivery === "external") return "soft";
  if (delivery === "hardcoded") return "hard";
  return "unknown";
}

/** Map AllManga mode + external-sub presence onto the shared mode. */
export function allmangaSubtitleMode(input: {
  readonly audio: AnimeAudioCategory;
  readonly hasExternalSubtitles: boolean;
}): AnimeSubtitleMode {
  if (input.audio === "dub") return input.hasExternalSubtitles ? "soft" : "unknown";
  return input.hasExternalSubtitles ? "soft" : "hard";
}
