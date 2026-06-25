// =============================================================================
// details-sheet.model.ts — pure view-model for the rich details sheet
//
// Merges an instant SEED (already-loaded SearchResult fields — header + synopsis
// with no network) with the optional fetched TitleDetail (gap-fill: studio, cast,
// seasons, trailer, links), plus history + availability, into typed sections each
// carrying a `loading` flag so the renderer can skeleton only the unresolved parts.
// =============================================================================

import type { TitleDetail, TitleLink } from "@/domain/catalog/title-detail";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@/services/storage/storage-read-models";

export type DetailsSheetSeed = {
  readonly title: string;
  readonly type: "movie" | "series";
  readonly year?: string;
  readonly score?: number;
  readonly posterUrl?: string;
  readonly genres?: readonly string[];
  readonly synopsis?: string;
  readonly episodeCount?: number;
};

export type DetailsSheetHistory = {
  readonly season?: number;
  readonly episode?: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly completed: boolean;
};

export type DetailsSheetAvailability = {
  readonly providers: readonly string[];
  readonly offline: boolean;
  readonly subs: readonly string[];
};

export type DetailsSheetModel = {
  readonly header: {
    readonly title: string;
    readonly posterUrl?: string;
    readonly metaLine: string;
    readonly score?: number;
    readonly genres: readonly string[];
    readonly statusLabel?: string;
  };
  readonly synopsis: { readonly loading: boolean; readonly text: string };
  readonly facts: {
    readonly loading: boolean;
    readonly studio?: string;
    readonly episodes?: string;
    readonly runtime?: string;
    readonly contentRating?: string;
  };
  readonly your: {
    readonly progressLabel?: string;
    readonly providers: readonly string[];
    readonly offline: boolean;
    readonly subs: readonly string[];
  };
  readonly cast: { readonly loading: boolean; readonly names: readonly string[] };
  readonly seasons: {
    readonly loading: boolean;
    readonly items: readonly { readonly season: number; readonly label: string }[];
  };
  readonly links: { readonly items: readonly TitleLink[] };
  readonly trailerUrl?: string;
};

function statusLabel(status: TitleDetail["status"] | undefined): string | undefined {
  if (!status || status === "unknown") return undefined;
  if (status === "airing") return "◉ airing";
  if (status === "upcoming") return "upcoming";
  return "finished";
}

function progressLabel(history: DetailsSheetHistory | null): string | undefined {
  if (!history) return undefined;
  const code =
    history.season && history.episode
      ? `S${String(history.season).padStart(2, "0")}E${String(history.episode).padStart(2, "0")}`
      : null;
  if (isFinished(history as HistoryProgress)) return [code, "watched"].filter(Boolean).join(" · ");
  const pct =
    history.durationSeconds && history.durationSeconds > 0
      ? `${Math.min(100, Math.round((history.positionSeconds / history.durationSeconds) * 100))}%`
      : null;
  return [code, pct, "in progress"].filter(Boolean).join(" · ");
}

export function buildDetailsSheet(input: {
  readonly seed: DetailsSheetSeed;
  readonly detail: TitleDetail | null;
  readonly history: DetailsSheetHistory | null;
  readonly availability: DetailsSheetAvailability | null;
  readonly seasonsExpanded?: boolean;
}): DetailsSheetModel {
  const { seed, detail, history, availability } = input;
  const score = detail?.score ?? seed.score;
  const genres = detail?.genres ?? seed.genres ?? [];
  const status = statusLabel(detail?.status);
  const typeLabel = seed.type === "movie" ? "Movie" : "Series";
  const metaLine = [
    typeLabel,
    seed.year,
    typeof score === "number" ? `★${score.toFixed(1)}` : undefined,
    status,
  ]
    .filter(Boolean)
    .join(" · ");

  const episodeCount = detail?.episodeCount ?? seed.episodeCount;
  const episodes =
    episodeCount !== undefined
      ? `${episodeCount} eps${detail?.seasonCount ? ` · ${detail.seasonCount} seasons` : ""}`
      : undefined;
  const synopsisText = detail?.synopsis ?? seed.synopsis ?? "";

  return {
    header: {
      title: seed.title,
      posterUrl: detail?.artwork?.poster ?? seed.posterUrl,
      metaLine,
      score,
      genres: genres.slice(0, 4),
      statusLabel: status,
    },
    synopsis: { loading: detail === null && !seed.synopsis, text: synopsisText },
    facts: {
      loading: detail === null,
      studio: detail?.studios?.slice(0, 2).join(" · ") || undefined,
      episodes,
      runtime: detail?.runtimeMinutes ? `${detail.runtimeMinutes} min` : undefined,
      contentRating: detail?.contentRating || undefined,
    },
    your: {
      progressLabel: progressLabel(history),
      providers: availability?.providers ?? [],
      offline: availability?.offline ?? false,
      subs: availability?.subs ?? [],
    },
    cast: {
      loading: detail === null,
      names: (detail?.cast ?? []).slice(0, 8).map((member) => member.name),
    },
    seasons: {
      loading: detail === null,
      items: (detail?.seasons ?? []).map((season) => ({
        season: season.season,
        label: season.name ?? `Season ${season.season}`,
      })),
    },
    links: { items: detail?.externalLinks ? [...detail.externalLinks] : [] },
    trailerUrl: detail?.trailerUrl,
  };
}
