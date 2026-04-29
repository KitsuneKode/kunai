import { defineProviderManifest } from "./factory";

export const BRAFLIX_PROVIDER_ID = "braflix" as const;

export const braflixManifest = defineProviderManifest({
  id: BRAFLIX_PROVIDER_ID,
  displayName: "Braflix",
  description: "Braflix (braflix.mov, no browser for metadata)",
  domain: "braflix.mov",
  recommended: false,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source"],
  runtimePorts: [
    {
      runtime: "node-fetch",
      operations: ["resolve-stream", "health-check"],
      browserSafe: false,
      relaySafe: false,
      localOnly: true,
    },
    {
      runtime: "playwright-lease",
      operations: ["resolve-stream", "resolve-subtitles", "refresh-source"],
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
      BRAFLIX_PROVIDER_ID,
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
    "Current implementation uses fetch for Braflix metadata and server lookup.",
    "It falls back to Playwright when the resolved source is an embed rather than a direct media URL.",
  ],
});
