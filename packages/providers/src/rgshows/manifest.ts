import { defineProviderManifest } from "@kunai/core";

export const RGSHOWS_PROVIDER_ID = "rgshows" as const;

export const rgshowsManifest = defineProviderManifest({
  id: RGSHOWS_PROVIDER_ID,
  displayName: "RGShows",
  aliases: ["P-Stream"],
  description: "Browserless RGShows fallback resolver (direct HLS) for movies and series",
  domain: "rgshows.ru",
  recommended: false,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "health-check"],
      browserSafe: true,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", RGSHOWS_PROVIDER_ID, "media-kind", "title", "season", "episode"],
    allowStale: true,
  },
  browserSafe: true,
  relaySafe: true,
  notes: ["Browserless fallback: TMDB-keyed GET to api.rgshows.ru returning a direct HLS stream."],
});
