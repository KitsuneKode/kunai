import { defineProviderManifest } from "@kunai/core";

export const HIANIME_PROVIDER_ID = "hianime" as const;

/** Which embed server Kunai resolves. ani-cli parity: only ZokoAnime is understood. */
export const HIANIME_SUPPORTED_SERVER = "ZokoAnime" as const;

export const hianimeManifest = defineProviderManifest({
  id: HIANIME_PROVIDER_ID,
  displayName: "HiAnime",
  aliases: ["hianime.at"],
  description: "Anime episodes in sub and dub via HiAnime (ani-cli parity lane)",
  domain: "hianime.at",
  recommended: false,
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
    upstreamHosts: [
      "hianime.at",
      "zokoanime.video",
      "hls2.aniwatchtv.uk",
      "megaplay.buzz",
      "vidtube.site",
    ],
  },
  status: "candidate",
  notes: [
    "Parity with ani-cli v5.1.2 (2026-09): /search, /api/theme/episode/list + servers, ZokoAnime embed window.__P base64(XOR(json, otaku-embed-v1)) → HLS master. Curl-path failures name the layer (no HTTP response vs HTTP NNN) per upstream #1902.",
    "Only the ZokoAnime server is resolved — HD-1/Vidstream-2 answer 410 upstream and VidPlay-1 (vidtube.site) is a different JWPlayer-style page. Both are recorded as observed/unsupported, matching ani-cli.",
    "Sub = Japanese audio, dub = English audio, each with its own embed fetch. No audio fallback: a missing mode fails closed like AniDB.",
    "Each season is a separate provider-native slug; there is no in-provider season routing.",
    "Bun/fetch may meet Cloudflare where curl passes; the client falls back to curl/curl-impersonate like AniDB/Miruro.",
    "Relay-safe for metadata RPC (/rpc/hianime). Video always stays direct; the relay has no media route.",
  ],
});
