export type CompiledSmokeScenarioId =
  | "movie"
  | "series"
  | "anime"
  | "queue-manual"
  | "auto-next"
  | "failed-handoff"
  | "shutdown-restore"
  | "return-to-shell";

export const COMPILED_SMOKE_SCENARIO_IDS = [
  "movie",
  "series",
  "anime",
  "queue-manual",
  "auto-next",
  "failed-handoff",
  "shutdown-restore",
  "return-to-shell",
] as const satisfies readonly CompiledSmokeScenarioId[];

export function isCompiledSmokeScenarioId(value: string): value is CompiledSmokeScenarioId {
  return (COMPILED_SMOKE_SCENARIO_IDS as readonly string[]).includes(value);
}

export const COMPILED_SMOKE_FIXTURES = {
  movie: {
    titleId: "tmdb:smoke-movie-1",
    title: "Smoke Movie",
    mediaKind: "movie" as const,
    providerId: "videasy",
    streamUrl: "https://smoke.kunai.test/movie-1.mp4",
  },
  series: {
    titleId: "tmdb:smoke-series-1",
    title: "Smoke Series",
    mediaKind: "series" as const,
    season: 1,
    episode: 2,
    providerId: "videasy",
    streamUrl: "https://smoke.kunai.test/series-s1e2.mp4",
  },
  anime: {
    titleId: "anilist:smoke-anime-1",
    title: "Smoke Anime",
    mediaKind: "anime" as const,
    absoluteEpisode: 7,
    providerId: "allanime",
    streamUrl: "https://smoke.kunai.test/anime-ep7.mp4",
  },
  queueManual: {
    claimedTitleId: "anilist:smoke-queue-claimed",
    claimedTitle: "Queue Claimed",
    claimedAbsoluteEpisode: 1,
    siblingTitleId: "anilist:smoke-queue-sibling",
    siblingTitle: "Queue Sibling",
    siblingAbsoluteEpisode: 2,
    streamUrl: "https://smoke.kunai.test/queue-claimed.mp4",
  },
  autoNext: {
    titleId: "anilist:smoke-autonext",
    title: "Auto Next Smoke",
    firstAbsoluteEpisode: 1,
    secondAbsoluteEpisode: 2,
    firstStreamUrl: "https://smoke.kunai.test/autonext-1.mp4",
    secondStreamUrl: "https://smoke.kunai.test/autonext-2.mp4",
  },
  failedHandoff: {
    titleId: "anilist:smoke-failed-handoff",
    title: "Failed Handoff",
    absoluteEpisode: 3,
    streamUrl: "https://smoke.kunai.test/failed-handoff.mp4",
  },
  shutdownRestore: {
    titleId: "anilist:smoke-shutdown",
    title: "Shutdown Restore",
    absoluteEpisode: 9,
    streamUrl: "https://smoke.kunai.test/shutdown-hold.mp4",
  },
  returnToShell: {
    titleId: "tmdb:smoke-shell-movie",
    title: "Return To Shell",
    mediaKind: "movie" as const,
    streamUrl: "https://smoke.kunai.test/shell-return.mp4",
  },
} as const;
