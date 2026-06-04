import { defineProviderManifest } from "@kunai/core";

export const VIDLINK_PROVIDER_ID = "vidlink" as const;

export const vidlinkManifest = defineProviderManifest({
  id: VIDLINK_PROVIDER_ID,
  displayName: "VidLink",
  aliases: ["P-Stream"],
  description:
    "Browserless VidLink resolver for movies and series — direct HLS with multi-language subtitles, no captcha or session token",
  domain: "vidlink.pro",
  recommended: true,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "subtitle-resolve", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "resolve-subtitles", "health-check"],
      browserSafe: true,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: [
      "provider",
      VIDLINK_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
      "episode",
      "subtitle",
    ],
    allowStale: true,
  },
  browserSafe: true,
  relaySafe: true,
  notes: [
    "Browserless: TMDB id is encrypted via enc-dec.app, then sources are fetched from vidlink.pro/api/b.",
    "Returns a multi-quality HLS playlist (mpv selects the rendition) plus provider subtitles.",
    "External dependency: relies on enc-dec.app for the id-encryption step; falls back to other providers if it is unavailable.",
  ],
});
