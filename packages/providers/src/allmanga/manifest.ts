import { defineProviderManifest } from "@kunai/core";

export const ALLANIME_PROVIDER_ID = "allanime" as const;

export const allanimeManifest = defineProviderManifest({
  id: ALLANIME_PROVIDER_ID,
  displayName: "AllManga",
  aliases: ["AllAnime"],
  description: "AllManga-compatible anime API client (sub & dub, no browser needed)",
  domain: "allmanga.to",
  recommended: false,
  mediaKinds: ["anime", "series"],
  capabilities: ["search", "episode-list", "source-resolve", "subtitle-resolve", "multi-source"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: [
        "search",
        "list-episodes",
        "resolve-stream",
        "resolve-subtitles",
        "health-check",
      ],
      browserSafe: false,
      relaySafe: false,
      localOnly: true,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", ALLANIME_PROVIDER_ID, "anime", "title", "episode", "audio", "subtitle"],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: false,
  notes: [
    "AllManga-compatible client uses local fetch/decode logic for search, catalog, and source resolution.",
    "The active CLI path is browserless; unsupported extracted embeds should return deterministic failure.",
  ],
});
