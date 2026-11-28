import { defineProviderManifest } from "@kunai/core";

export const ANILIGHT_PROVIDER_ID = "anilight" as const;

export const anilightManifest = defineProviderManifest({
  id: ANILIGHT_PROVIDER_ID,
  displayName: "AniLight",
  aliases: ["anilight.live"],
  description: "Anime episodes in sub and dub through AniLight's AniList-native API",
  domain: "anilight.live",
  recommended: false,
  mediaKinds: ["anime"],
  catalogIdentity: "anilist",
  capabilities: [
    "search",
    "episode-list",
    "source-resolve",
    "subtitle-resolve",
    "multi-source",
    "quality-ranked",
  ],
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
      browserSafe: true,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: [
      "provider",
      ANILIGHT_PROVIDER_ID,
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
  browserSafe: true,
  relaySafe: true,
  relayProfile: {
    upstreamHosts: ["api.anilight.live"],
  },
  notes: [
    "Browserless AniList bridge: /api/anime/check-exists?anilistId= resolves the provider slug, /api/watch/{slug} carries episode availability, and /api/sources uses a short-lived x-source-session token.",
    "Sub and dub are separate audio presentations; a missing requested mode fails closed rather than silently substituting the other audio.",
    "Opaque upstream media tokens are played through the provider-declared streamProxies (/e/{token}); caption tokens use /api/proxy/captions?token=... .",
  ],
});
