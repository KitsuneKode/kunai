import { defineProviderManifest } from "@kunai/core";

export const KICKASSANIME_PROVIDER_ID = "kickassanime" as const;

export const kickassanimeManifest = defineProviderManifest({
  id: KICKASSANIME_PROVIDER_ID,
  displayName: "KickAssAnime",
  aliases: ["KAA"],
  domain: "kaa.lt",
  description: "Independent anime source — HLS with separate subtitle tracks, sub and dub",
  recommended: true,
  mediaKinds: ["anime"],
  catalogIdentity: "provider-native",
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
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: [
      "provider",
      KICKASSANIME_PROVIDER_ID,
      "anime",
      "title",
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
    upstreamHosts: ["kaa.lt", "kickass-anime.ro", "krussdomi.com"],
  },
  notes: [
    "2026-09-11: added as a second anime source independent of Miruro, and the only one that ships subtitles as separate tracks rather than burned in.",
    "Catalog is a plain JSON API: POST /api/fsearch {query, page}; GET /api/show/<slug>/episodes?ep=<page>&lang=<locale>; GET /api/show/<slug>/episode/ep-<n>-<epSlug> -> servers. Locales: ja-JP is sub, en-US is dub; dub coverage is often partial (Naruto: 2 of 220).",
    "The site's JS is obfuscated, but nothing on the stream path is encrypted: the cat-player page carries the manifest and subtitles as serialized Astro island props ([0, value] / [1, array] tuples).",
    "Headers are the whole trick, and each hop wants a different one. The HLS manifest needs `Referer: https://krussdomi.com/` (403 without). Segments — MPEG-TS served as .jpg from a rotating CDN host (st1.advancedairesearchlab.xyz on 2026-09-11, st1.narutokun.xyz on 2026-09-12) — need `Origin: https://krussdomi.com`; the referer alone is refused. Subtitle .vtt files need the same. Both headers are derived from the player's own origin rather than hardcoded, so a player move carries them along.",
    "mpv applies the stream's referer and Origin to --sub-file / sub-add requests too, so subtitles load with no per-track headers (verified: sid=1 external webvtt).",
    "Sub and dub are usually ONE file: the master carries a dub per audio rendition (Frieren ships nine, Japanese marked DEFAULT), so both locales hand back the same manifest id. The track is mpv's to choose via --alang, which is why `selectKaaAudio` reads the rendition group instead of trusting the locale — and why Kunai's audio setting had to stop reaching mpv as the literal `dub`, which matched no track and played Japanese.",
    "The variant playlists are video-only (the audio lives in the rendition group), so the ladder is never expanded into per-quality URLs — mpv gets the master and picks. That is also why qualityRank is 0 rather than an invented height.",
    "Only VidStreaming (HLS) is used. BirdStream serves DASH with many subtitle languages, but its manifest answered 404 for the title tested; the doubled slash in its URL (https:////bl.krussdomi.com) is normalized if it is ever enabled.",
    "The domain rotates (kaa.to -> kaa.mx -> kickass-anime.ro -> kaa.lt). kickass-anime.ro still 301s to the current one and is asked when kaa.lt stops answering at connection level. Its redirect is read by hand (redirect: manual) and accepted only for an https `kaa.<tld>` / `kickass-anime.<tld>` host: an old alias can lapse and be bought, and following it blindly would hand the new owner the API base and every stream URL behind it.",
  ],
});
