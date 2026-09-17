/**
 * Network-free series + anime playback walkthrough fixtures.
 *
 * The Ink app is an interactive state machine over these view-models. VHS types
 * into the real browse / episode / loading / post-play shells. Playback progress
 * advances at 1× media time. If the typed session is long, the tape may set
 * `Set PlaybackSpeed` on the encode only — the app never advertises a demo rate.
 */

import type { PostPlayShellProps } from "@/app-shell/post-play-shell";
import type {
  BrowseShellOption,
  LoadingShellStage,
  LoadingShellState,
  PlaybackRecommendationRailItem,
  ShellAction,
} from "@/app-shell/types";
import { toBrowseResultOption } from "@/app/search/browse-option-mappers";
import type { SearchResult } from "@/domain/types";

/** Visible search spinner before fixture rows land. Not a test sleep. */
export const SEARCH_DELAY_MS = 400;

/** Time on the resolving surface before auto-advance to playing. */
export const RESOLVE_DURATION_MS = 3200;

/**
 * Safety cap for the launcher. The tape drives the session; this only kills a
 * hung Ink process. Sized for a typed two-lane walkthrough plus encode slack.
 */
export const PLAYBACK_WALKTHROUGH_WATCHDOG_MS = 180_000;

export type WalkthroughLane = "series" | "anime";

export type WalkthroughPhase = "browse" | "episodes" | "resolving" | "playing" | "post-play";

export type WalkthroughEpisodeRow = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
};

const SERIES_RESULTS: readonly SearchResult[] = [
  {
    id: "tmdb:83867",
    type: "series",
    title: "Andor",
    year: "2022",
    overview: "A thief is pulled into the rebellion against the Empire.",
    posterPath: null,
    rating: 8.4,
    episodeCount: 12,
  },
  {
    id: "tmdb:82856",
    type: "series",
    title: "The Mandalorian",
    year: "2019",
    overview: "A bounty hunter keeps a promise across the Outer Rim.",
    posterPath: null,
    rating: 8.5,
    episodeCount: 24,
  },
  {
    id: "tmdb:84958",
    type: "series",
    title: "Loki",
    year: "2021",
    overview: "The God of Mischief is recruited by the Time Variance Authority.",
    posterPath: null,
    rating: 8.2,
    episodeCount: 12,
  },
];

const ANIME_RESULTS: readonly SearchResult[] = [
  {
    id: "anilist:154587",
    type: "series",
    title: "Frieren: Beyond Journey's End",
    year: "2023",
    overview: "An elven mage walks a quieter road after the hero's party disbands.",
    posterPath: null,
    rating: 8.9,
    episodeCount: 28,
    isAnime: true,
    externalIds: { anilistId: "154587" },
  },
  {
    id: "anilist:16498",
    type: "series",
    title: "Attack on Titan",
    year: "2013",
    overview: "Humanity fights behind walls against the Titans.",
    posterPath: null,
    rating: 8.7,
    episodeCount: 87,
    isAnime: true,
    externalIds: { anilistId: "16498" },
  },
  {
    id: "anilist:101922",
    type: "series",
    title: "Demon Slayer",
    year: "2019",
    overview: "A boy joins the Demon Slayer Corps to save his sister.",
    posterPath: null,
    rating: 8.6,
    episodeCount: 44,
    isAnime: true,
    externalIds: { anilistId: "101922" },
  },
];

const SERIES_RECS: readonly PlaybackRecommendationRailItem[] = [
  { id: "tmdb:82856", title: "The Mandalorian", type: "series", year: "2019" },
  { id: "tmdb:84958", title: "Loki", type: "series", year: "2021" },
  { id: "tmdb:1396", title: "Breaking Bad", type: "series", year: "2008" },
];

const ANIME_RECS: readonly PlaybackRecommendationRailItem[] = [
  { id: "anilist:16498", title: "Attack on Titan", type: "series", year: "2013" },
  { id: "anilist:101922", title: "Demon Slayer", type: "series", year: "2019" },
  { id: "anilist:113415", title: "Jujutsu Kaisen", type: "series", year: "2020" },
];

export function browseResultsFor(
  lane: WalkthroughLane,
): readonly BrowseShellOption<SearchResult>[] {
  const results = lane === "series" ? SERIES_RESULTS : ANIME_RESULTS;
  return results.map((result) => toBrowseResultOption(result));
}

/**
 * Rank fixture rows so the typed query sits first, then the rest of the lane
 * catalog — enough list to arrow through without calling a provider.
 */
export function searchResultsFor(
  lane: WalkthroughLane,
  query: string,
): readonly BrowseShellOption<SearchResult>[] {
  const all = browseResultsFor(lane);
  const needle = query.trim().toLowerCase();
  if (!needle) return all;
  return [...all].sort((left, right) => {
    const leftHit = left.label.toLowerCase().includes(needle) ? 0 : 1;
    const rightHit = right.label.toLowerCase().includes(needle) ? 0 : 1;
    return leftHit - rightHit;
  });
}

export function browseQueryFor(lane: WalkthroughLane): string {
  return lane === "series" ? "Andor" : "Frieren";
}

export function providerFor(lane: WalkthroughLane): string {
  return lane === "series" ? "videasy" : "allmanga";
}

export function fallbackProviderFor(lane: WalkthroughLane): string {
  return lane === "series" ? "Vidlink" : "Miruro";
}

export function titleFor(lane: WalkthroughLane): string {
  return lane === "series" ? "Andor" : "Frieren: Beyond Journey's End";
}

export function episodeRowsFor(lane: WalkthroughLane): readonly WalkthroughEpisodeRow[] {
  if (lane === "series") {
    return [
      { id: "s01e01", label: "S01E01  Kassa", detail: "45m · watched" },
      { id: "s01e02", label: "S01E02  That Would Be Me", detail: "40m · watched" },
      { id: "s01e03", label: "S01E03  Reckoning", detail: "46m · resume 18:49" },
      { id: "s01e04", label: "S01E04  Aldhani", detail: "47m" },
      { id: "s01e05", label: "S01E05  The Axe Forgets", detail: "43m" },
      { id: "s01e06", label: "S01E06  The Eye", detail: "50m" },
    ];
  }
  return [
    { id: "e01", label: "E01  The Journey's End", detail: "24m · watched" },
    { id: "e02", label: "E02  It Didn't Have to Be You…", detail: "24m · watched" },
    { id: "e03", label: "E03  Killing Magic", detail: "24m · watched" },
    { id: "e04", label: "E04  The Sages of the Sword Village", detail: "24m · resume 08:12" },
    { id: "e05", label: "E05  Phantoms of the Dead", detail: "24m" },
    { id: "e06", label: "E06  The Hero of the Village", detail: "24m" },
  ];
}

/** Episode the tape arrows to before Enter. Picker itself starts at 0. */
export function selectedEpisodeIndex(lane: WalkthroughLane): number {
  return lane === "series" ? 2 : 3;
}

const RESOLVE_STAGES: readonly LoadingShellStage[] = [
  "finding-stream",
  "preparing-provider",
  "preparing-player",
  "starting-playback",
];

export function resolveStageAt(sceneElapsedMs: number, durationMs: number): LoadingShellStage {
  const bucket = Math.min(
    RESOLVE_STAGES.length - 1,
    Math.floor((sceneElapsedMs / Math.max(1, durationMs)) * RESOLVE_STAGES.length),
  );
  return RESOLVE_STAGES[bucket] ?? "finding-stream";
}

const SERIES_PLAYING = {
  episodeLabel: "S01E03",
  nextEpisodeLabel: "S01E04  Aldhani",
  previousEpisodeLabel: "S01E02  That Would Be Me",
  startPositionSeconds: 18 * 60 + 49,
  durationSeconds: 46 * 60,
} as const;

const ANIME_PLAYING = {
  episodeLabel: "E04",
  nextEpisodeLabel: "E05  Phantoms of the Dead",
  previousEpisodeLabel: "E03  Killing Magic",
  startPositionSeconds: 8 * 60 + 12,
  durationSeconds: 24 * 60,
} as const;

function playingMeta(lane: WalkthroughLane) {
  return lane === "series" ? SERIES_PLAYING : ANIME_PLAYING;
}

export function playingPositionSeconds(lane: WalkthroughLane, sceneElapsedMs: number): number {
  const meta = playingMeta(lane);
  const advanced = sceneElapsedMs / 1000;
  return Math.min(meta.durationSeconds, meta.startPositionSeconds + advanced);
}

function loadingBase(lane: WalkthroughLane): Omit<LoadingShellState, "operation" | "stage"> {
  const meta = playingMeta(lane);
  const provider = providerFor(lane);
  const providerLabel = lane === "series" ? "Videasy" : "AllManga";
  return {
    title: titleFor(lane),
    subtitle: meta.episodeLabel,
    episodeLabel: meta.episodeLabel,
    currentSeason: 1,
    currentEpisode: lane === "series" ? 3 : 4,
    providerName: providerLabel,
    providerId: provider,
    cancellable: true,
    fallbackAvailable: true,
    fallbackProviderName: fallbackProviderFor(lane),
    isSeriesPlayback: true,
    hasNextEpisode: true,
    hasPreviousEpisode: true,
    nextEpisodeLabel: meta.nextEpisodeLabel,
    previousEpisodeLabel: meta.previousEpisodeLabel,
    contentKind: lane === "anime" ? "anime" : "series",
    titleType: "series",
    subtitleStatus: "en",
  };
}

export function resolvingState(lane: WalkthroughLane, sceneElapsedMs: number): LoadingShellState {
  const stage = resolveStageAt(sceneElapsedMs, RESOLVE_DURATION_MS);
  const stageDetail =
    stage === "finding-stream"
      ? "Matching title…"
      : stage === "preparing-provider"
        ? "Resolving direct link…"
        : stage === "preparing-player"
          ? "Opening stream…"
          : "Handing off to mpv…";
  return {
    ...loadingBase(lane),
    operation: "resolving",
    stage,
    stageDetail,
    progress: Math.min(95, Math.round((sceneElapsedMs / RESOLVE_DURATION_MS) * 100)),
  };
}

export function playingState(lane: WalkthroughLane, sceneElapsedMs: number): LoadingShellState {
  const meta = playingMeta(lane);
  const position = playingPositionSeconds(lane, sceneElapsedMs);
  return {
    ...loadingBase(lane),
    operation: "playing",
    currentPosition: position,
    duration: meta.durationSeconds,
    qualityLabel: "1080p · 24fps",
    downloadStatus: "18.4 MB/s",
    subtitleTrack: "en",
    audioTrack: "eng",
    bufferHealth: "healthy",
    playbackFactsStrip: "1080p · eng audio · en sub",
    playbackSourceLine: `direct · ${providerFor(lane)}`,
    playbackKeysHint: "q stop · n next · p prev · a autoplay · u autoskip",
  };
}

export function postPlayProps(lane: WalkthroughLane): PostPlayShellProps {
  const meta = playingMeta(lane);
  return {
    title: titleFor(lane),
    episodeLabel: meta.episodeLabel,
    nextEpisodeLabel: meta.nextEpisodeLabel,
    previousEpisodeLabel: meta.previousEpisodeLabel,
    postPlayState: { kind: "mid-series" },
    recommendations: lane === "series" ? SERIES_RECS : ANIME_RECS,
    totalEpisodes: lane === "series" ? 12 : 28,
    watchedEpisodes: lane === "series" ? 3 : 4,
    currentSeason: 1,
    currentEpisode: lane === "series" ? 3 : 4,
    contentKind: lane === "anime" ? "anime" : "series",
    titleType: "series",
    resumePositionSeconds: meta.startPositionSeconds,
    episodeDurationSeconds: meta.durationSeconds,
  };
}

const POST_PLAY_ACTION_COUNT = 5;

export function clampPostPlayActionIndex(index: number): number {
  if (index < 0) return 0;
  if (index >= POST_PLAY_ACTION_COUNT) return POST_PLAY_ACTION_COUNT - 1;
  return index;
}

/**
 * Catalog-lane switches the tape can reach from browse or post-play. YouTube is
 * out of scope for this harness, so toggle wraps series ↔ anime only.
 */
export function laneAfterShellAction(
  lane: WalkthroughLane,
  action: ShellAction,
): WalkthroughLane | null {
  if (action === "anime-mode") return "anime";
  if (action === "series-mode") return "series";
  if (action === "toggle-mode") return lane === "series" ? "anime" : "series";
  if (action === "toggle-mode-reverse") return lane === "anime" ? "series" : "anime";
  return null;
}
