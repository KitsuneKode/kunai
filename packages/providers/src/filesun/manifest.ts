import { defineProviderManifest } from "@kunai/core";

export const FILESUN_PROVIDER_ID = "filesun" as const;

export const filesunManifest = defineProviderManifest({
  id: FILESUN_PROVIDER_ID,
  displayName: "FileSuN",
  aliases: ["embedsun.cc"],
  description: "Movies and series through Atlantic's public embed lookup, FileSuN slot",
  domain: "embedsun.cc",
  recommended: false,
  mediaKinds: ["movie", "series"],
  catalogIdentity: "tmdb",
  capabilities: ["source-resolve", "subtitle-resolve", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "resolve-subtitles", "health-check"],
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
      FILESUN_PROVIDER_ID,
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
  browserSafe: false,
  relaySafe: false,
  notes: [
    "Atlantic title/year lookup; TV coordinates are 1-based.",
    "Only the FileSuN embed is verified and resolved; direct HLS with captions.",
    "Local HTTP only: no browser, credentials, or relay.",
  ],
});
