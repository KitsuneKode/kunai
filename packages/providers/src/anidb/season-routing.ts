/**
 * Deterministic AniDB season routing.
 *
 * AniDB models each season as its own title, so a season-2 request against a
 * base title must be routed to a sibling entry rather than resolved against the
 * base. Two failure modes drive the design:
 *
 * - Resolving the wrong title silently is worse than not resolving at all, so an
 *   ambiguous or unevidenced match returns `null` and the caller reports a
 *   structured `not-found`.
 * - A missing season label is NOT evidence that a title is absolute-numbered.
 *   `absoluteEpisode` is consumed only when the routed title's own episode
 *   catalog contains that exact number; everything else uses the one-based cour
 *   episode and records why.
 */

import type { EpisodeIdentity } from "@kunai/types";

import type { AnidbSearchResult } from "./browse-parser";
import type { AnidbEpisodeEntry } from "./client";

export type AnidbEpisodeNumberingEvidence =
  | {
      readonly kind: "absolute-episode-catalog";
      readonly routedShowId: string;
      readonly requestedAbsoluteEpisode: number;
      readonly matchedEpisodeId: number;
    }
  | {
      readonly kind: "cour";
      readonly reason:
        | "absolute-episode-not-supplied"
        | "absolute-episode-not-in-routed-catalog"
        | "routed-title-is-season-specific"
        | "routed-season-sibling";
      readonly requestedAbsoluteEpisode?: number;
    };

export type AnidbSeasonRouteEvidence =
  | { readonly kind: "base-season"; readonly normalizedBaseTitle: string }
  | {
      readonly kind: "season-search";
      readonly query: string;
      readonly matchedTitle: string;
      readonly matchedSeason: number;
      readonly titleMatch: "exact" | "prefix";
    };

export interface AnidbSeasonRoute {
  readonly requestedSeason: number;
  readonly baseShowId: string;
  readonly routedShowId: string;
  readonly episodeNumber: number;
  readonly usedAbsoluteEpisode: boolean;
  readonly numberingEvidence: AnidbEpisodeNumberingEvidence;
  readonly evidence: AnidbSeasonRouteEvidence;
}

type ScoredSeasonCandidate = {
  readonly candidate: AnidbSearchResult;
  readonly score: number;
  readonly titleMatch: "exact" | "prefix";
};

export async function routeAnidbSeason(input: {
  readonly base: AnidbSearchResult;
  readonly episode?: EpisodeIdentity;
  readonly search: (query: string, signal?: AbortSignal) => Promise<readonly AnidbSearchResult[]>;
  readonly episodes: (
    showId: string,
    signal?: AbortSignal,
  ) => Promise<readonly AnidbEpisodeEntry[]>;
  readonly signal?: AbortSignal;
}): Promise<AnidbSeasonRoute | null> {
  const requestedSeason = positiveInteger(input.episode?.season) ?? 1;
  const courEpisode = positiveInteger(input.episode?.episode) ?? 1;
  const absoluteEpisode = positiveInteger(input.episode?.absoluteEpisode);
  const baseEvidence = input.base.seasonEvidence;

  if (requestedSeason === 1) {
    let episodeNumber = courEpisode;
    let numberingEvidence: AnidbEpisodeNumberingEvidence;

    if (absoluteEpisode === null) {
      numberingEvidence = { kind: "cour", reason: "absolute-episode-not-supplied" };
    } else if (baseEvidence.seasonNumber !== null) {
      // The title names its own season, so its episode numbers are per-season.
      numberingEvidence = {
        kind: "cour",
        reason: "routed-title-is-season-specific",
        requestedAbsoluteEpisode: absoluteEpisode,
      };
    } else {
      const matchedEpisode = (await input.episodes(input.base.id, input.signal)).find(
        (entry) => entry.number === absoluteEpisode,
      );
      if (matchedEpisode) {
        episodeNumber = absoluteEpisode;
        numberingEvidence = {
          kind: "absolute-episode-catalog",
          routedShowId: input.base.id,
          requestedAbsoluteEpisode: absoluteEpisode,
          matchedEpisodeId: matchedEpisode.id,
        };
      } else {
        numberingEvidence = {
          kind: "cour",
          reason: "absolute-episode-not-in-routed-catalog",
          requestedAbsoluteEpisode: absoluteEpisode,
        };
      }
    }

    return {
      requestedSeason,
      baseShowId: input.base.id,
      routedShowId: input.base.id,
      episodeNumber,
      usedAbsoluteEpisode: numberingEvidence.kind === "absolute-episode-catalog",
      numberingEvidence,
      evidence: { kind: "base-season", normalizedBaseTitle: baseEvidence.normalizedBaseTitle },
    };
  }

  const query = `${baseEvidence.normalizedBaseTitle} Season ${requestedSeason}`;
  const candidates = (await input.search(query, input.signal))
    .filter((candidate) => candidate.seasonEvidence.seasonNumber === requestedSeason)
    .flatMap((candidate): ScoredSeasonCandidate[] => {
      const normalized = candidate.seasonEvidence.normalizedBaseTitle;
      const base = baseEvidence.normalizedBaseTitle;
      if (normalized === base) return [{ candidate, score: 2, titleMatch: "exact" }];
      if (normalized.startsWith(`${base} `)) {
        return [{ candidate, score: 1, titleMatch: "prefix" }];
      }
      return [];
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.candidate.id.localeCompare(right.candidate.id),
    );

  const selected = candidates[0];
  if (!selected) return null;
  // A tie means we cannot tell which sibling was asked for. Fail closed.
  if (candidates[1]?.score === selected.score) return null;

  return {
    requestedSeason,
    baseShowId: input.base.id,
    routedShowId: selected.candidate.id,
    episodeNumber: courEpisode,
    usedAbsoluteEpisode: false,
    numberingEvidence: {
      kind: "cour",
      reason: "routed-season-sibling",
      ...(absoluteEpisode !== null ? { requestedAbsoluteEpisode: absoluteEpisode } : {}),
    },
    evidence: {
      kind: "season-search",
      query,
      matchedTitle: selected.candidate.title,
      matchedSeason: requestedSeason,
      titleMatch: selected.titleMatch,
    },
  };
}

function positiveInteger(value: number | undefined): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
