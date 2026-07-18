import { defineProviderManifest } from "@kunai/core";

export const RGSHOWS_PROVIDER_ID = "rgshows" as const;

export const rgshowsManifest = defineProviderManifest({
  id: RGSHOWS_PROVIDER_ID,
  displayName: "RGShows",
  aliases: ["P-Stream"],
  description: "Reliable backup source for movies and series",
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
  relayProfile: {
    upstreamHosts: ["api.rgshows.ru", "rgshows.ru", "www.rgshows.ru"],
  },
  notes: ["Browserless fallback: TMDB-keyed GET to api.rgshows.ru returning a direct HLS stream."],
});
