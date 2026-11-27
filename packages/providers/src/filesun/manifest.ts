import { defineProviderManifest } from "@kunai/core";

export const FILESUN_PROVIDER_ID = "filesun" as const;

export const filesunManifest = defineProviderManifest({
  id: FILESUN_PROVIDER_ID,
  displayName: "FileSuN",
  aliases: ["embedsun.cc"],
  description: "Movies and series through Atlantic's public embed lookup, FileSuN slot",
  domain: "embedsun.cc",
  recommended: false,
  mediaKinds: ["movie", "series"],
  catalogIdentity: "tmdb",
  capabilities: ["source-resolve", "subtitle-resolve", "quality-ranked"],
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
      FILESUN_PROVIDER_ID,
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
  relaySafe: false,
  notes: [
    "Browserless: pal.hls.lol/fs/embed answers {found, embeds} by title, year and type (plus 1-based seasonId/episodeId for TV); the FileSuN row is an embedsun.cc JW Player page whose sources array names a direct HLS master on *.vmpx.online.",
    "One verified server only: the VOE and Doodstream embed rows exist upstream but were not verified in the 2026-11-27 intake and are not resolved here.",
    "Subtitles come from the page's baseTracks captions on srt.vidmoly.me plus any SUBTITLES renditions in the fetched master; no multiaudio inventory was measured.",
    "All-HTTP local integration: no credentials, JS execution, browser session, or media relay — metadata stays direct, so relaySafe is off.",
  ],
});
