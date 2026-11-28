import { defineProviderManifest } from "@kunai/core";

export const ANIMEPARADISE_PROVIDER_ID = "animeparadise" as const;

export const animeparadiseManifest = defineProviderManifest({
  id: ANIMEPARADISE_PROVIDER_ID,
  displayName: "AnimeParadise",
  aliases: ["animeparadise.moe"],
  description: "Anime through AnimeParadise's own AniList-mapped catalog and direct HLS",
  domain: "animeparadise.moe",
  recommended: false,
  mediaKinds: ["anime"],
  catalogIdentity: "anilist",
  capabilities: ["search", "episode-list", "source-resolve", "subtitle-resolve", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
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
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: [
      "provider",
      ANIMEPARADISE_PROVIDER_ID,
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
    "AniList/MAL identity is checked before episode lookup.",
    "Reads the watch page's rotating Flight action without executing scripts.",
    "Direct, local-only HLS with sub audio and ASS/VTT tracks; no relay.",
  ],
});
