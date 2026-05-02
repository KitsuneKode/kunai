import { defineProviderManifest } from "./factory";

export const ALLANIME_PROVIDER_ID = "allanime" as const;

export const allanimeManifest = defineProviderManifest({
  id: ALLANIME_PROVIDER_ID,
  displayName: "AllManga",
  description: "AllManga-compatible anime API client (sub & dub, no browser needed)",
  domain: "allmanga.to",
  recommended: false,
  mediaKinds: ["anime", "series"],
  capabilities: ["search", "episode-list", "source-resolve", "subtitle-resolve", "multi-source"],
  runtimePorts: [
    {
      runtime: "node-fetch",
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
    keyParts: ["provider", ALLANIME_PROVIDER_ID, "anime", "title", "episode", "audio", "subtitle"],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: false,
  notes: [
    "AllManga-compatible client uses local fetch/decode logic for search, catalog, and many source paths.",
    "Playwright remains declared because some extracted embed URLs can still require browser interception.",
  ],
});
