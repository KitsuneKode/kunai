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
    "Browserless: public /search and /anime/{slug} JSON, then the watch page's own Flight POST to its getEpisode server action. The action id is discovered by reading at most two same-site bundle chunks named by the watch page's WatchProvider module — remote code is read, never executed.",
    "Catalog identity is verified canonically: the title search must resolve to exactly one row, and /anime/{slug} must agree on _id and the AniList/MAL mapping before an id is used — a sequel cannot borrow its first season's episodes.",
    "One verified HLS server on stream.animeparadise.moe, muxed audio (sub only — no dub was observed). Subtitles arrive as ASS on api.animeparadise.moe/stream/file and VTT on stream.animeparadise.moe/captions.",
    "Transport drift: the streamLink locator is an opaque upstream handle answered through stream.animeparadise.moe/m3u8; the Next-Action id rotates per deployment, so resolve re-reads it from the current bundle every time.",
    "All-HTTP local integration: no credentials, JS execution, browser session, or media relay — metadata stays direct, so relaySafe is off.",
  ],
});
