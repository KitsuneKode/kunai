import { defineProviderManifest } from "@kunai/core";

export const VIDEOSY_PROVIDER_ID = "videasy" as const;

/** @deprecated Use VIDEOSY_PROVIDER_ID — kept for config/cache migration. */
export const VIDKING_PROVIDER_ID = VIDEOSY_PROVIDER_ID;

export const videasyManifest = defineProviderManifest({
  id: VIDEOSY_PROVIDER_ID,
  displayName: "Videasy Direct",
  aliases: ["VidKing", "Cineplay", "Cineby", "HDToday", "Bitcine"],
  description: "Fast direct streams with source selection and subtitles",
  domain: "videasy.to",
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
      "api.speedracelight.com",
      "api.wingsdatabase.com",
      "db.videasy.to",
      "db.speedracelight.com",
      "db.wingsdatabase.com",
      "player.videasy.to",
      "www.vidking.net",
      "www.cineplay.to",
      "www.cineby.at",
      "moon.ironbubble.site",
      "moon.ironwallnet.net",
    ],
  },
  notes: [
    "2026-07-16: active stream API is api.speedracelight.com (player.videasy.to / cineby.at); api.wingsdatabase.com is a mirror.",
    "2026-07-16: Cineby server catalog labels (Yoru/Neon/Sage/Jett/…) map to /cdn /neon2 /ym /jett /… routes.",
    "2026-07-18: Inventory UI order matches cineby Servers (Yoru first). Resolve Phase A is Yoru → Cypher → Neon → Sage → Jett → Breach → Vyse; localized servers stay Phase B.",
    "2026-07-18: Resolve-gate always segment-probes HLS before attesting streamReachabilityVerified; dead CDNs fail over instead of hanging.",
    "2026-07-11: stream sources-with-title routes on api.videasy.to remain route-dead (404).",
    "bc-frontend is the default Videasy client profile; stream/API origin/referer follow cineby.at (seed already did).",
    "Do not mark browser-safe because local decrypt/runtime behavior is required.",
  ],
});

/** @deprecated Use videasyManifest */
export const vidkingManifest = videasyManifest;
