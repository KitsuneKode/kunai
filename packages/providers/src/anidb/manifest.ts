import { defineProviderManifest } from "@kunai/core";

export const ANIDB_PROVIDER_ID = "anidb" as const;

export const anidbManifest = defineProviderManifest({
  id: ANIDB_PROVIDER_ID,
  displayName: "AniDB",
  aliases: ["anidb.app"],
  description: "Registered default anime adapter; catalog and streams are third-party",
  domain: "anidb.app",
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
      ANIDB_PROVIDER_ID,
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
    upstreamHosts: ["anidb.app", "hls.anidb.app"],
    defaultHeaders: {
      Referer: "https://anidb.app/",
    },
  },
  notes: [
    "Parity with ani-cli v5.0 (2026-08-01): browse search, /api/frontend anime episodes + episode languages, embed → HLS master.",
    "Episode metadata follows the explicit anidb.app → official anidb.net AID cross-link, then reads official XML; AniList/Jikan fill missing fields and still artwork.",
    "Bun/fetch often gets Cloudflare 403 on anidb.app HTML/API; production path uses curl with a Chrome UA (dossier-proven).",
    "HLS media on hls.anidb.app usually works with native fetch after the embed URL is obtained. Ladder expansion uses the same curl fallback as metadata so a relay miss does not collapse to one auto row.",
    "Sub = Japanese audio (jpn embed); dub = English audio (eng embed) when the languages API exposes it. No independently addressable subtitle track has been observed — do not advertise hardsub.",
    "Relay-safe for metadata RPC (/rpc/anidb). Video stays direct: `videoFallback` is persisted but has no production reader and no `/stream/` handler.",
  ],
});
