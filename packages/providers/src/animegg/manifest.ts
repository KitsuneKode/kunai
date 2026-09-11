import { defineProviderManifest } from "@kunai/core";

export const ANIMEGG_PROVIDER_ID = "animegg" as const;

export const animeggManifest = defineProviderManifest({
  id: ANIMEGG_PROVIDER_ID,
  displayName: "AnimeGG",
  domain: "www.animegg.org",
  description: "Independent anime source — direct MP4s, sub and dub, no AniList dependency",
  recommended: true,
  mediaKinds: ["anime"],
  catalogIdentity: "provider-native",
  capabilities: ["search", "episode-list", "source-resolve", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["search", "list-episodes", "resolve-stream", "health-check"],
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
      ANIMEGG_PROVIDER_ID,
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
    upstreamHosts: ["www.animegg.org", "animegg.org"],
  },
  notes: [
    "2026-09-11: added as the anime lane's independent second source. Its value is what it does NOT share with Miruro: its own catalog (provider-native slugs, no AniList), its own site, its own CDN. Miruro reaches AnimeGG too, as its `moo` server — but only through miruro.bz, so it dies with Miruro. This adapter does not.",
    "Four plain HTML documents, no JavaScript and no crypto: /search/?q= -> /series/<slug> -> /<slug>-episode-<n> -> /embed/<id>, which carries `var videoSources = [{file, label}]` of direct MP4s.",
    "Sub and dub are the episode page's own `#videos` tabs (`data-id`, `data-mirror`, `data-version`), so audio is read, never guessed. Naruto ep 1 exposes subbed 25881 and dubbed 25882.",
    "The subbed version is hard-subbed — burned-in English, no separate track. It advertises no subtitle-resolve and must not claim soft subs.",
    'Streams are /play/<id>/video.mp4?for=<token>, which 302s to a per-request vidcache host. That CDN answers `{"error":"Invalid request (bad hand off)"}` with HTTP 500 to anything that is not its player — a plain or ranged GET included — while mpv plays the same URL. Never read a probe of these as evidence the stream is dead.',
    "`bk` on each source is a backup, but not a uniform one: a direct CDN URL for One Piece and an mp4upload embed page for Naruto. Unused until one extractor covers both.",
    "No Cloudflare challenge on any of the four documents; the four HTML documents need no referer.",
    "The STREAM does need one. Without a referer the CDN refuses the hand-off and mpv writes no frame; with the episode page as referer it plays. animegg.org 302s either way, so a status check on the /play URL cannot see this — only the player can.",
  ],
});
