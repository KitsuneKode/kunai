import { defineProviderManifest } from "@kunai/core";

export const MOVY_PROVIDER_ID = "movy" as const;

export const movyManifest = defineProviderManifest({
  id: MOVY_PROVIDER_ID,
  displayName: "Movy",
  aliases: ["movy.sx"],
  description: "Movies and series via a multi-lane source aggregator",
  domain: "movy.sx",
  recommended: false,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "quality-ranked", "multi-source"],
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
      MOVY_PROVIDER_ID,
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
  relaySafe: true,
  relayProfile: {
    upstreamHosts: ["api.wecollege.net"],
  },
  notes: [
    "Browserless: TMDB id gets a short-lived seed from api.wecollege.net/seed, then each named lane (atlanta, denver, miami, …) answers an encrypted `/{lane}/sources` payload that the client XOR-decrypts into {sources, subtitles}.",
    "Each lane is a distinct upstream scraper (stillhaven, vidzy, workers.dev proxies, multi-language mirrors); lanes surface as individual sources so server switching and fallback cycling apply per lane.",
    "Anime lane (anikoto/sources-id) is not wired yet — movies and series only.",
    "External dependency: api.wecollege.net is movy.sx's own backend; if it moves or rate-limits, resolve degrades to the next provider.",
  ],
});
