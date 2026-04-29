import { defineProviderManifest } from "./factory";

export const CINEBY_ANIME_PROVIDER_ID = "cineby-anime" as const;

export const cinebyAnimeManifest = defineProviderManifest({
  id: CINEBY_ANIME_PROVIDER_ID,
  displayName: "Cineby Anime",
  description: "Cineby Anime (HiAnime via anime-db.videasy.net)",
  domain: "cineby.sc",
  recommended: false,
  mediaKinds: ["anime", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source"],
  runtimePorts: [
    {
      runtime: "playwright-lease",
      operations: ["resolve-stream", "resolve-subtitles", "refresh-source", "health-check"],
      browserSafe: false,
      relaySafe: false,
      localOnly: true,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", CINEBY_ANIME_PROVIDER_ID, "anime", "title", "episode", "subtitle"],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: false,
  notes: ["Current path builds a Cineby anime URL and resolves it with Playwright interception."],
});
