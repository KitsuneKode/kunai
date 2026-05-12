import { defineProviderManifest } from "@kunai/core";

export const VIDKING_PROVIDER_ID = "vidking" as const;

export const vidkingManifest = defineProviderManifest({
  id: VIDKING_PROVIDER_ID,
  displayName: "VidKing",
  aliases: ["Cineby", "HDToday", "Videasy"],
  description: "VidKing direct resolver for Cineby/HDToday-compatible Videasy streams",
  domain: "videasy.net",
  recommended: true,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source", "quality-ranked"],
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
      VIDKING_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
      "episode",
      "subtitle",
    ],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: false,
  notes: [
    "Current CLI implementation uses the direct api.videasy.net payload/decryption path only.",
    "If the direct payload is unavailable, the CLI fails fast instead of leasing a browser.",
    "Do not mark browser-safe because the implementation depends on local WASM assets and Node runtime behavior.",
  ],
});
