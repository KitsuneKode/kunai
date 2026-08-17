import { defineProviderManifest } from "@kunai/core";

export const ALLANIME_PROVIDER_ID = "allanime" as const;

export const allanimeManifest = defineProviderManifest({
  id: ALLANIME_PROVIDER_ID,
  displayName: "AllManga",
  aliases: ["AllAnime"],
  description: "Anime episodes in sub and dub — the primary anime source",
  domain: "allmanga.to",
  recommended: false,
  mediaKinds: ["anime"],
  catalogIdentity: "provider-native",
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
    keyParts: [
      "provider",
      ALLANIME_PROVIDER_ID,
      "anime",
      "title",
      "episode",
      "audio",
      "subtitle",
      "quality",
      "startup",
      "source",
      "stream",
    ],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: false,
  relayProfile: {
    upstreamHosts: [
      "api.mkissa.net",
      "mkissa.to",
      "cdn.mkissa.net",
      "allanime.day",
      "wp.youtube-anime.com",
    ],
    videoRelayHosts: ["fast4speed.rsvp", "tools.fast4speed.rsvp"],
    defaultHeaders: {
      Referer: "https://mkissa.to",
    },
  },
  notes: [
    "AllManga-compatible client uses local fetch/decode logic for search, catalog, and source resolution.",
    "The active CLI path is browserless; unsupported extracted embeds should return deterministic failure.",
    "Source inventory: Default, Yt-mp4, S-mp4, Mp4 (mp4upload scrape), Luf-Mp4, Ak. Filemoon is gone.",
    "2026-08: mkissa crypto requires buildId=119 (rotated from 81) + /client-crypto/v1/bootstrap (x-aa-boot), 7-day epochs. ani-cli v5 moved primary to anidb.app.",
  ],
});
