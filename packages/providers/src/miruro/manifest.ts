import { defineProviderManifest } from "@kunai/core";

export const MIRURO_PROVIDER_ID = "miruro" as const;

/**
 * The one Miruro server order. Discovery ranking, fallback construction when the
 * pipe returns no provider map, and the known-catalog placeholder rows all read
 * this list.
 *
 * `pewe` (AniDB HLS) and `moo` (AnimeGG MP4) are fast and reliable (~300-500ms),
 * followed by `bee` (Anikoto) and `ally` (AllManga). Stalling/444-returning
 * servers (`kiwi`, `hop`) go to the end so they do not block faster candidates.
 */
export const MIRURO_SERVER_TRY_ORDER = [
  "pewe",
  "moo",
  "bee",
  "ally",
  "bonk",
  "dune",
  "ANIMEKAI",
  "ANIMEZ",
  "ZORO",
  "kiwi",
  "hop",
] as const;

export const miruroManifest = defineProviderManifest({
  id: MIRURO_PROVIDER_ID,
  displayName: "Miruro",
  description: "Alternate anime source — useful when a title is missing elsewhere",
  domain: "www.miruro.bz",
  recommended: false,
  mediaKinds: ["anime"],
  catalogIdentity: "anilist",
  capabilities: [
    "episode-list",
    "source-resolve",
    "subtitle-resolve",
    "multi-source",
    "quality-ranked",
  ],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "health-check"],
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
      MIRURO_PROVIDER_ID,
      "media-kind",
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
    upstreamHosts: ["www.miruro.bz", "www.miruro.ru"],
  },
  status: "candidate",
  notes: [
    "2026-07-16: Browser network on www.miruro.bz/watch/{anilistId}/... uses GET /api/secure/pipe?e=… (200 plain + x-obfuscated). HLS on vault*.ultracloud / owocdn with stream.referer https://kwik.cx/.",
    "Bun fetch often gets CF 403 HTML on pipe; production path falls back to curl --http2 with browser headers (dossier-proven on this machine).",
    "Primary hosts: www.miruro.bz, www.miruro.ru. Bare miruro.bz/.ru are 301 redirects to www. and still CF-block at the pipe path; miruro.com serves a different app shell with no /api/secure/pipe; miruro.tv/.to are TLS-dead — all stay off the resolve list.",
    "Uses Miruro pipe API with XOR/gzip decryption key 71951034f8fbcf53d89db52ceb3dc22c.",
    "The default anime priority names AniDB first; that list is ordering, not an allowlist, so Miruro remains a registered fallback and manually selectable when the curl/http2 path works.",
    "May hit Cloudflare rate limits if called too frequently.",
    "2026-08-17: curl --http2 with browser headers also receives CF 403 HTML from some networks; the WAF block message now carries a relay hint.",
  ],
});
