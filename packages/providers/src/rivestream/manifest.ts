import { defineProviderManifest } from "@kunai/core";

export const RIVESTREAM_PROVIDER_ID = "rivestream" as const;

export const rivestreamManifest = defineProviderManifest({
  id: RIVESTREAM_PROVIDER_ID,
  displayName: "Rivestream",
  description: "Rivestream direct resolver candidate (MurmurHash)",
  domain: "rivestream.app",
  recommended: true,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "resolve-subtitles", "health-check"],
      browserSafe: false,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: [
      "provider",
      RIVESTREAM_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
      "episode",
      "subtitle",
    ],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: true,
  status: "candidate",
  notes: [
    "Bypasses Playwright entirely by generating the 32-bit MurmurHash signature natively in Node.js.",
  ],
});
