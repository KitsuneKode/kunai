import { defineProviderManifest } from "@kunai/core";

export const VIDROCK_PROVIDER_ID = "vidrock" as const;

export const vidrockManifest = defineProviderManifest({
  id: VIDROCK_PROVIDER_ID,
  displayName: "VidRock",
  aliases: ["Granite", "P-Stream"],
  description:
    "Browserless VidRock fallback resolver (AES-addressed direct HLS/MP4) for movies and series",
  domain: "vidrock.net",
  recommended: false,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "multi-source", "quality-ranked"],
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
    keyParts: ["provider", VIDROCK_PROVIDER_ID, "media-kind", "title", "season", "episode"],
    allowStale: true,
  },
  browserSafe: true,
  relaySafe: true,
  notes: [
    "Browserless fallback: AES-CBC encrypts the TMDB id, fetches vidrock.net/api, and returns direct HLS/MP4 server URLs.",
  ],
});
