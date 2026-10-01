import { defineProviderManifest } from "@kunai/core";

export const ANIMEKAI_PROVIDER_ID = "animekai" as const;

export const animekaiManifest = defineProviderManifest({
  id: ANIMEKAI_PROVIDER_ID,
  displayName: "AnimeKai",
  aliases: ["animekai.be"],
  description: "Anime episodes in sub and dub via AnimeKai (ani-cli next parity lane)",
  domain: "animekai.be",
  // Not the shipped default — hianime holds that slot — but a direct-HTTP
  // second anime provider whose infrastructure shares nothing with
  // hianime.at or Miruro's pipe.
  recommended: true,
  mediaKinds: ["anime"],
  catalogIdentity: "provider-native",
  capabilities: [
    "search",
    "episode-list",
    "source-resolve",
    "subtitle-resolve",
    "multi-source",
    "quality-ranked",
  ],
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
      ANIMEKAI_PROVIDER_ID,
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
    // Fetched hosts only: animekai.be (browse/watch/sources) and megaplay.buzz
    // (embed + getSources). The rotating stream CDN (nexabloom.top et al.) is
    // never fetched through the relay — video stays direct.
    upstreamHosts: ["animekai.be", "megaplay.buzz"],
  },
  status: "production",
  notes: [
    "Parity with ani-cli next branch (v5.2.0): /browse literal-phrase search with longest-word retry, /watch/<slug> episode flags (data-sub/data-dub), /watch/<slug>/ep/<n>/sources JSON, megaplay.buzz embed data-id → /stream/getSources?id= (X-Requested-With) → base64url(AES-256-CBC(json)) → HLS master.",
    "Sub/dub are separate embed rows per episode; a missing mode fails closed like AniDB, never silently plays the other.",
    "The sources endpoint lists several embeds per mode; dead lanes are walked in order (in-provider multi-server fallback).",
    "getSources JSON carries intro/outro timestamps and soft subtitle tracks — provider-native skip metadata plus external subs.",
    "Bun/fetch may meet Cloudflare where curl passes; the client falls back to curl/curl-impersonate like HiAnime/AniDB.",
    "Relay-safe for metadata RPC (/rpc/animekai). Video always stays direct; the relay has no media route.",
  ],
});
