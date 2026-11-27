import { defineProviderManifest } from "@kunai/core";

export const VIDBOLT_PROVIDER_ID = "vidbolt" as const;

export const vidboltManifest = defineProviderManifest({
  id: VIDBOLT_PROVIDER_ID,
  displayName: "VidBolt",
  aliases: ["vidbolt.pro", "vidbolt.st"],
  description: "Movies and series through VidBolt's multi-server direct API",
  domain: "vidbolt.pro",
  recommended: false,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "resolve-subtitles", "health-check"],
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
      VIDBOLT_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
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
    upstreamHosts: ["vidbolt.pro", "vidbolt.st"],
  },
  notes: [
    "Browserless TMDB-addressed API: /api/resolve?type=movie&id= or type=tv&id=&season=&episode=, then server iteration through the public exclude parameter.",
    "Embedded HLS master text is parsed locally for rendition languages, subtitle playlists, and variant inventory; media remains direct.",
    "No Cloudflare/Turnstile bypass: a challenge response is classified as blocked and the lane falls through.",
  ],
});
