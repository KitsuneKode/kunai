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
  description:
    "Primary anime source — sub and dub from many backends behind one AniList-keyed pipe",
  domain: "www.miruro.bz",
  recommended: true,
  mediaKinds: ["anime"],
  catalogIdentity: "anilist",
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
      operations: ["search", "resolve-stream", "health-check"],
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
    upstreamHosts: [
      "www.miruro.bz",
      "www.miruro.ru",
      "www.miruro.to",
      "www.miruro.tv",
      // Mirror discovery reads this; it is metadata about hosts, never media.
      "status.miruro.com",
    ],
  },
  notes: [
    "2026-07-16: Browser network on www.miruro.bz/watch/{anilistId}/... uses GET /api/secure/pipe?e=… (200 plain + x-obfuscated). HLS on vault*.ultracloud / owocdn with stream.referer https://kwik.cx/.",
    "Bun fetch often gets CF 403 HTML on pipe; production path falls back to curl --http2 with browser headers (dossier-proven on this machine).",
    "2026-09-11: all four www. mirrors (.bz, .ru, .to, .tv) serve /api/secure/pipe — the earlier 'miruro.tv/.to are TLS-dead' reading came from a network whose reachability to them flaps (same host timed out, failed fast, then answered within minutes). Bare origins are 301 redirects to www.; miruro.com is a landing page with no pipe and is excluded by name.",
    "2026-09-11: mirror order is live. status.miruro.com is Uptime Kuma with public JSON (/api/status-page/miruro plus /api/status-page/heartbeat/miruro); it is read in the background, names mirrors Kunai does not ship with, and only ever demotes a mirror it calls down. The mirror that last answered leads. See miruro/mirrors.ts.",
    "Uses Miruro pipe API with XOR/gzip decryption key 71951034f8fbcf53d89db52ceb3dc22c.",
    "2026-09-11: default anime provider (config providerDefaultsRevision 1), ahead of AniDB and AllAnime. The case for it is structural, not a speed claim: it fronts ~a dozen backends, so an upstream outage costs one server — on 2026-09-11 anidb.app and api.mkissa.net were both refusing us while moo/bee/bonk/kiwi served streams.",
    "2026-09-11: searches through its own pipe (path `search`, query `q` plus `type: ANIME`; `search`/`query` are ignored and return the popular list). It relays AniList's catalog, so it kept answering while AniList's API was disabled. `dubLanguages` on those rows is voice-actor data, not availability.",
    "2026-09-11: the pipe returns a backend's URL whether or not that backend is up — `pewe` served hls.anidb.app URLs (503) through AniDB's maintenance, and won the cycle. Candidates are now rejected on 404/410/429/502/503/504 from one ranged GET, and only when that status came from the host asked. Never on 401/403 (owocdn answers Bun's fetch 403 while mpv plays), never on a plain 500 (AnimeGG hands off to vidcache, which 500s anything but its player), and never on a cross-host redirect.",
    "Structural dependency: every backend is reached through miruro.bz/.ru. If Miruro itself goes dark, all of them go with it — which is why AniDB and AllAnime stay registered behind it.",
    "May hit Cloudflare rate limits if called too frequently.",
    "2026-09-11: the pipe is reachable — Bun fetch is always CF-403'd (its TLS fingerprint), and curl clears the edge on both mirrors. The superseded 2026-08-17 note claiming curl also received CF 403 was measured through a predicate that read any HTML body as a Cloudflare block, including the mirror's own `502 upstream unreachable` page.",
    "2026-09-12: 429 joined that list. The release signoff's anime lane resolved a pewe stream that answered 429 to mpv, to curl with the stream's headers and to curl with none — a rate-limited master is refused to everyone, unlike the 403 that only Bun's fetch sees. Skipping it costs one server attempt; accepting it cost a failed play on the default anime provider. With pewe skipped the cycle lands on moo and plays (verified: 1080p frame).",
    "A 444/502 from the pipe is one of Miruro's backing servers being down (pewe follows AniDB, ally follows AllManga), not a WAF block, and must not stop the cycle — the remaining servers are usually healthy.",
  ],
});
