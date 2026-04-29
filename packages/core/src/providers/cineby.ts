import { defineProviderManifest } from "./factory";

export const CINEBY_PROVIDER_ID = "cineby" as const;

export const cinebyManifest = defineProviderManifest({
  id: CINEBY_PROVIDER_ID,
  displayName: "Cineby",
  description: "Cineby",
  domain: "cineby.sc",
  recommended: false,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source"],
  runtimePorts: [
    {
      runtime: "playwright-lease",
      operations: ["resolve-stream", "resolve-subtitles", "refresh-source", "health-check"],
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
      CINEBY_PROVIDER_ID,
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
    "Current production path uses Playwright because Cineby requires interactive player scraping.",
  ],
});
