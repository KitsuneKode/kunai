import { defineProviderManifest } from "@kunai/core";

export const VIDEOSY_PROVIDER_ID = "videasy" as const;

/** @deprecated Use VIDEOSY_PROVIDER_ID — kept for config/cache migration. */
export const VIDKING_PROVIDER_ID = VIDEOSY_PROVIDER_ID;

export const videasyManifest = defineProviderManifest({
  id: VIDEOSY_PROVIDER_ID,
  displayName: "Videasy",
  aliases: ["VidKing", "Cineplay", "Cineby", "HDToday", "Bitcine"],
  description: "Direct Videasy API resolver for Cineplay, Cineby, and legacy embed frontends",
  domain: "videasy.to",
  recommended: false,
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
      VIDEOSY_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
      "episode",
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
  relayProfile: {
    upstreamHosts: [
      "api.videasy.to",
      "db.videasy.to",
      "player.videasy.to",
      "www.vidking.net",
      "www.cineplay.to",
    ],
  },
  notes: [
    "2026-07-11: stream sources-with-title routes are curated route-dead; demoted from series default.",
    "Current CLI implementation uses the direct api.videasy.to payload/decryption path only.",
    "Cineplay (bc-frontend) is the default Videasy client profile; vidking.net remains an override.",
    "If the direct payload is unavailable, the CLI fails fast instead of leasing a browser.",
    "Do not mark browser-safe because the implementation depends on local WASM assets and Node runtime behavior.",
  ],
});

/** @deprecated Use videasyManifest */
export const vidkingManifest = videasyManifest;
