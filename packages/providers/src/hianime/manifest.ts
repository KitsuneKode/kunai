import { defineProviderManifest } from "@kunai/core";

export const HIANIME_PROVIDER_ID = "hianime" as const;

/** The primary embed server — ani-cli parity lane and preferred lead. */
export const HIANIME_SUPPORTED_SERVER = "ZokoAnime" as const;

/**
 * MegaPlay-family servers resolved through the shared data-id/getSources
 * contract — live again upstream (they 410'd in Sept). VidPlay-1
 * (vidtube.site) is a different player page and stays unsupported.
 */
export const HIANIME_MEGAPLAY_SERVERS = ["HD-1", "Vidstream-2"] as const;

export const hianimeManifest = defineProviderManifest({
  id: HIANIME_PROVIDER_ID,
  displayName: "HiAnime",
  aliases: ["hianime.at"],
  description: "Anime episodes in sub and dub via HiAnime (ani-cli parity lane)",
  domain: "hianime.at",
  // The shipped anime-lane default — anidb.app answers 503 at the origin.
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
      HIANIME_PROVIDER_ID,
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
    // Fetched hosts only: hianime.at (search/catalog/servers), zokoanime.video
    // (ZokoAnime embeds), megaplay.buzz (HD-1/Vidstream-2 embeds + getSources
    // XHR), aniwatchtv.uk + norami.top + nexabloom.top + shiora.top (HLS
    // ladders and subtitles — parent domains so CDN host rotation stays
    // relay-routed via suffix match; megaplay's CDN parents are the observed
    // set and may grow). vidtube.site stays out: its player contract is
    // unimplemented, so nothing fetches it.
    upstreamHosts: [
      "hianime.at",
      "zokoanime.video",
      "aniwatchtv.uk",
      "megaplay.buzz",
      "norami.top",
      "nexabloom.top",
      "shiora.top",
    ],
  },
  // Production since it became the anime lane default (providerDefaultsRevision
  // 3): it is the configured provider search hits first, so it cannot wear the
  // `· candidate` marker.
  status: "production",
  notes: [
    "Parity with ani-cli v5.1.4: /search, /api/theme/episode/list + servers, ZokoAnime embed window.__P base64(XOR(json, otaku-embed-v1)) → HLS master. Curl-path failures name the layer (no HTTP response vs HTTP NNN) per upstream #1902. Pin: scripts/parity-references.json.",
    "Three servers resolve as provider-local lanes in API order: ZokoAnime first (ani-cli parity), then HD-1 and Vidstream-2 — both megaplay.buzz embeds speaking the shared data-id/getSources/AES-256-CBC contract (upstream revived them after the Sept 410 window; live-verified). A dead lane falls through to the next server; VidPlay-1 (vidtube.site) is a different JWPlayer-style page and stays observed-only.",
    "Sub = Japanese audio, dub = English audio, each with its own embed fetch. No audio fallback: a missing mode fails closed like AniDB.",
    "Each season is a separate provider-native slug; there is no in-provider season routing.",
    "Bun/fetch may meet Cloudflare where curl passes; the client falls back to curl/curl-impersonate like AniDB/Miruro.",
    "Relay-safe for metadata RPC (/rpc/hianime). Video always stays direct; the relay has no media route.",
  ],
});
