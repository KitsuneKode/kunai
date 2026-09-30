/**
 * The status sweep's probe table, derived from the shared production roster.
 *
 * `provider-status-sweep.ts` used to name its providers by hand, which is how
 * the published status board covered eight providers while production ran
 * twelve. `SWEEP_PROBES` is now built from `PRODUCTION_PROVIDER_MODULES` so a
 * new provider cannot silently miss the board — it either carries a fixture
 * here or an entry in `SWEEP_EXEMPTIONS` with a reason, and the coverage test
 * in `test/provider-status-sweep-coverage.test.ts` fails otherwise.
 */
import type { ProviderModule, ProviderResolveInput } from "@kunai/types";

import { PRODUCTION_PROVIDER_MODULES } from "../src/production-modules";

const MOVIE_INPUT: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "movie",
  title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
  episode: { season: 1, episode: 1 },
};

const ONE_PIECE_ANILIST: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "anime",
  title: { id: "anilist:21", kind: "anime", title: "One Piece", anilistId: "21" },
  episode: { season: 1, episode: 1 },
};

const ALLMANGA_ONE_PIECE: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "anime",
  title: { id: "allanime:ReooPAxPMsHM4KPMY", kind: "anime", title: "One Piece" },
  episode: { season: 1, episode: 1 },
};

const ANIDB_ONE_PIECE: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "anime",
  title: { id: "one-piece-69", kind: "anime", title: "One Piece" },
  episode: { season: 1, episode: 1 },
};

const YOUTUBE_INPUT: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "video",
  title: {
    id: "youtube:dQw4w9WgXcQ",
    kind: "video",
    title: "Rick Astley - Never Gonna Give You Up",
  },
  episode: { season: 1, episode: 1 },
};

interface SweepFixture {
  /** Origin-level reachability probe — the host resolve actually talks to. */
  readonly frontDoor: string;
  readonly input: ProviderResolveInput;
}

/**
 * Known-good resolve input per production provider. Anime providers that match
 * titles by name (animegg, kickassanime) take the AniList-shaped input — they
 * search their own catalog by the title string. allanime and anidb keep their
 * provider-native ids because their id spaces are not AniList's.
 */
const SWEEP_FIXTURES = {
  videasy: { frontDoor: "https://api.videasy.to", input: MOVIE_INPUT },
  vidlink: { frontDoor: "https://vidlink.pro", input: MOVIE_INPUT },
  vidrock: { frontDoor: "https://vidrock.net", input: MOVIE_INPUT },
  rivestream: { frontDoor: "https://www.rivestream.app", input: MOVIE_INPUT },
  movy: { frontDoor: "https://api.wecollege.net", input: MOVIE_INPUT },
  anidb: { frontDoor: "https://anidb.app", input: ANIDB_ONE_PIECE },
  allanime: { frontDoor: "https://api.allanime.day", input: ALLMANGA_ONE_PIECE },
  hianime: { frontDoor: "https://hianime.at", input: ONE_PIECE_ANILIST },
  miruro: { frontDoor: "https://www.miruro.bz", input: ONE_PIECE_ANILIST },
  animegg: { frontDoor: "https://www.animegg.org", input: ONE_PIECE_ANILIST },
  kickassanime: { frontDoor: "https://kaa.lt", input: ONE_PIECE_ANILIST },
  youtube: { frontDoor: "https://www.youtube.com", input: YOUTUBE_INPUT },
} satisfies Record<string, SweepFixture>;

const SWEEP_FIXTURE_BY_ID = new Map(Object.entries(SWEEP_FIXTURES));

/**
 * A production provider may sit out the sweep only for a runtime reason
 * recorded here — never by simply having no fixture. Kept empty rather than
 * dropped so the "swept or exempt" contract stays explicit.
 */
export const SWEEP_EXEMPTIONS: Record<string, string> = {};

export interface SweepProbe {
  readonly id: string;
  readonly module: Pick<ProviderModule, "providerId" | "resolve">;
  readonly frontDoor: string;
  readonly input: ProviderResolveInput;
}

export const SWEEP_PROBES: readonly SweepProbe[] = PRODUCTION_PROVIDER_MODULES.flatMap((module) => {
  if (module.providerId in SWEEP_EXEMPTIONS) return [];
  const fixture = SWEEP_FIXTURE_BY_ID.get(module.providerId);
  // A production module with neither a fixture nor an exemption lands nowhere
  // — the coverage test is what makes that a loud failure instead of a quiet
  // missing row.
  if (!fixture) return [];
  return [
    {
      id: module.providerId,
      module,
      frontDoor: fixture.frontDoor,
      input: fixture.input,
    },
  ];
});
