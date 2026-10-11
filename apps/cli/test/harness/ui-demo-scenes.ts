/**
 * Network-free fixtures for the README UI walkthrough.
 *
 * Titles are Blender Foundation open movies and the provider is a generic
 * "sample", so the recording shows the real shells without naming a copyrighted
 * title or a real source. No ratings or speeds are invented: a field the real
 * app would fill from a provider is left out rather than made up.
 */

import type { PostPlayShellProps } from "@/app-shell/post-play-shell";
import type { BrowseShellOption, LoadingShellState } from "@/app-shell/types";
import { toBrowseResultOption } from "@/app/search/browse-option-mappers";
import type { SearchResult } from "@/domain/types";

/** Visible search spinner before fixture rows land. Not a test sleep. */
export const SEARCH_DELAY_MS = 350;

/** Time on the resolving surface before auto-advance to playing. */
export const RESOLVE_DURATION_MS = 3200;

export const TITLE = "Sintel";
export const PROVIDER = "sample";
export const DURATION_SECONDS = 888;
export const START_SECONDS = 192;

const RESULTS: readonly SearchResult[] = [
  {
    id: "demo:sintel",
    type: "movie",
    title: "Sintel",
    year: "2010",
    overview: "A girl searches for the dragon she lost.",
    posterPath: null,
  },
  {
    id: "demo:big-buck-bunny",
    type: "movie",
    title: "Big Buck Bunny",
    year: "2008",
    overview: "A giant rabbit deals with three bullying rodents.",
    posterPath: null,
  },
  {
    id: "demo:tears-of-steel",
    type: "movie",
    title: "Tears of Steel",
    year: "2012",
    overview: "Warriors and scientists try to save the world from robots.",
    posterPath: null,
  },
];

/** Rank fixture rows so the typed query sits first, then the rest of the catalog. */
export function searchResults(query: string): readonly BrowseShellOption<SearchResult>[] {
  const all = RESULTS.map((result) => toBrowseResultOption(result));
  const needle = query.trim().toLowerCase();
  if (!needle) return all;
  return [...all].sort((left, right) => {
    const leftHit = left.label.toLowerCase().includes(needle) ? 0 : 1;
    const rightHit = right.label.toLowerCase().includes(needle) ? 0 : 1;
    return leftHit - rightHit;
  });
}

const STAGES = [
  "finding-stream",
  "preparing-provider",
  "preparing-player",
  "starting-playback",
] as const;

function base(): Omit<LoadingShellState, "operation" | "stage"> {
  return {
    title: TITLE,
    providerName: "Sample",
    providerId: PROVIDER,
    cancellable: true,
    fallbackAvailable: true,
    fallbackProviderName: "Backup",
    isSeriesPlayback: false,
    hasNextEpisode: false,
    hasPreviousEpisode: false,
    contentKind: "movie",
    titleType: "movie",
    subtitleStatus: "en",
  };
}

export function resolvingState(elapsedMs: number): LoadingShellState {
  const bucket = Math.min(
    STAGES.length - 1,
    Math.floor((elapsedMs / RESOLVE_DURATION_MS) * STAGES.length),
  );
  const stage = STAGES[bucket] ?? "finding-stream";
  const detail =
    stage === "finding-stream"
      ? "Matching title…"
      : stage === "preparing-provider"
        ? "Resolving direct link…"
        : stage === "preparing-player"
          ? "Opening stream…"
          : "Handing off to mpv…";
  return {
    ...base(),
    operation: "resolving",
    stage,
    stageDetail: detail,
    progress: Math.min(95, Math.round((elapsedMs / RESOLVE_DURATION_MS) * 100)),
  };
}

/** `stalled` forces the real recovery prompt so the tape can show it without a real stall. */
export function playingState(elapsedMs: number, stalled: boolean): LoadingShellState {
  return {
    ...base(),
    operation: "playing",
    currentPosition: Math.min(DURATION_SECONDS, START_SECONDS + elapsedMs / 1000),
    duration: DURATION_SECONDS,
    qualityLabel: "1080p",
    subtitleTrack: "en",
    audioTrack: "eng",
    bufferHealth: stalled ? "stalled" : "healthy",
    playbackFactsStrip: "1080p · eng audio · en sub",
    playbackSourceLine: `direct · ${PROVIDER}`,
    playbackKeysHint: "q stop · n next · p prev · a autoplay · u autoskip",
  };
}

export function postPlayProps(): PostPlayShellProps {
  return {
    title: TITLE,
    episodeLabel: "",
    postPlayState: { kind: "mid-series" },
    recommendations: [
      { id: "demo:big-buck-bunny", title: "Big Buck Bunny", type: "movie", year: "2008" },
      { id: "demo:tears-of-steel", title: "Tears of Steel", type: "movie", year: "2012" },
    ],
    contentKind: "movie",
    titleType: "movie",
    resumePositionSeconds: START_SECONDS,
    episodeDurationSeconds: DURATION_SECONDS,
  };
}
