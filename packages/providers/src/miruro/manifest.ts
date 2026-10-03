import { defineProviderManifest } from "@kunai/core";

export const MIRURO_PROVIDER_ID = "miruro" as const;

/**
 * The one Miruro server order, in family names. Discovery ranking, fallback
 * construction when the play matrix names nothing known, and the known-catalog
 * placeholder rows all read this list — rankMiruroServerId maps the catalog's
 * versioned `server` strings (`icarus-1-1`, `vault-6-direct-1`, `HD-2`) back to
 * their family, so a lane that renames its instance suffix keeps its rank.
 *
 * Ordered by evidence (2026-10-03): `animepahe` serves labeled multi-quality
 * HLS direct; the `icarus`/`vault-*-direct` lanes serve direct streams plus
 * subtitle tracks; `Vid`/`HD-*` are the KickassAnime/Anikoto lanes with
 * subtitle inventory; the `Vidstream`/`Vidplay`/`BYFMS`/`DGHG`/`Bird` lanes
 * are mostly embed-only upstream. Anything unlisted ranks after these, in
 * play-response order.
 */
export const MIRURO_SERVER_TRY_ORDER = [
  "animepahe",
  "icarus",
  "vault-6-direct",
  "Vid",
  "HD",
  "Vidstream",
  "Vidplay",
  "BYFMS",
  "DGHG",
  "Bird",
] as const;

/**
 * Family matchers in TRY_ORDER sequence — the catalog's `server` strings carry
 * per-instance suffixes, so ranking matches the family, not the literal name.
 * `Vid` is exact-matched so it cannot swallow `Vidstream`/`Vidplay`.
 */
const MIRURO_SERVER_FAMILY_PATTERNS = [
  /^animepahe$/i,
  /^icarus/i,
  /^vault-\d+-direct/i,
  /^vid$/i,
  /^hd-\d+/i,
  /^vidstream/i,
  /^vidplay/i,
  /^byfms$/i,
  /^dghg$/i,
  /^bird$/i,
] as const;

/**
 * Rank a catalog `server` string into its TRY_ORDER family. Unlisted families
 * share the tail rank so the play response's own order breaks ties — upstream's
 * order beats a guess.
 */
export function rankMiruroServerId(serverId: string): number {
  const index = MIRURO_SERVER_FAMILY_PATTERNS.findIndex((pattern) => pattern.test(serverId));
  return index >= 0 ? index : MIRURO_SERVER_FAMILY_PATTERNS.length;
}

export const miruroManifest = defineProviderManifest({
  id: MIRURO_PROVIDER_ID,
  displayName: "Miruro",
  description:
    "Primary anime source — sub and dub from many backends behind one AniList-keyed catalog",
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
    "2026-10-03: `/api/secure/pipe` is gone on every mirror (SPA 404) — upstream replaced it with a catalog REST API at `/api/v1/*`. Success bodies are `application/octet-stream` = XOR('miruro/catalog') + gzip + JSON; errors are plain `application/problem+json`. Query shapes are allowlisted to the site's own calls (search limit ∈ {5,15}, `*_id_in` + limit=100, `episodes` needs `kind` + limit=10000, `play` takes no query). Bun fetch clears the shape gate with a browser header set — the old pipe's TLS-fingerprint CF block does not apply here. One `play` call returns the full track/provider/server matrix with direct stream URLs and per-server Referer headers.",
    "2026-07-16 (pipe era, superseded 2026-10-03): Browser network on www.miruro.bz/watch/{anilistId}/... used GET /api/secure/pipe?e=… (200 plain + x-obfuscated). HLS on vault*.ultracloud / owocdn with stream.referer https://kwik.cx/ — the catalog API still emits those hosts and headers, so this note stays load-bearing for stream handling.",
    "Pipe era: Bun fetch often got CF 403 HTML on the pipe; the production path fell back to curl --http2 with browser headers. That transport is gone — the catalog API clears Bun fetch outright.",
    "2026-09-11 (mirror facts are still current; the pipe path is not): all four www. mirrors (.bz, .ru, .to, .tv) answered — the earlier 'miruro.tv/.to are TLS-dead' reading came from a network whose reachability to them flaps (same host timed out, failed fast, then answered within minutes). Bare origins are 301 redirects to www.; miruro.com is a landing page with no API and is excluded by name.",
    "2026-09-11: mirror order is live. status.miruro.com is Uptime Kuma with public JSON (/api/status-page/miruro plus /api/status-page/heartbeat/miruro); it is read in the background, names mirrors Kunai does not ship with, and only ever demotes a mirror it calls down. The mirror that last answered leads. See miruro/mirrors.ts.",
    "Pipe era: the retired transport used XOR/gzip decryption key 71951034f8fbcf53d89db52ceb3dc22c. The catalog API uses key 'miruro/catalog' instead.",
    "2026-09-11: default anime provider (config providerDefaultsRevision 1), ahead of AniDB and AllAnime. The case for it is structural, not a speed claim: it fronts ~a dozen backends, so an upstream outage costs one server — on 2026-09-11 anidb.app and api.mkissa.net were both refusing us while moo/bee/bonk/kiwi served streams.",
    "2026-09-11 (pipe-era query shape; the /api/v1 catalog has its own allowlist): searches ran through the pipe's `search` path with `q` plus `type: ANIME`; `search`/`query` were ignored and returned the popular list. It relays AniList's catalog, so it kept answering while AniList's API was disabled. `dubLanguages` on those rows is voice-actor data, not availability — still true on the catalog.",
    "2026-09-11: a backend's URL ships whether or not that backend is up — `pewe` served hls.anidb.app URLs (503) through AniDB's maintenance, and won the cycle. Candidates are rejected on 404/410/429/502/503/504 from one ranged GET, and only when that status came from the host asked. Never on 401/403 (owocdn answers Bun's fetch 403 while mpv plays), never on a plain 500 (AnimeGG hands off to vidcache, which 500s anything but its player), and never on a cross-host redirect. The status list predates the catalog and still applies — the catalog emits the same backend URLs.",
    "Structural dependency: every backend is reached through miruro.bz/.ru. If Miruro itself goes dark, all of them go with it — which is why AniDB and AllAnime stay registered behind it.",
    "May hit Cloudflare rate limits if called too frequently.",
    "2026-09-11 (pipe-era transport, superseded): the pipe was reachable — Bun fetch was always CF-403'd (its TLS fingerprint), and curl cleared the edge on both mirrors. The superseded 2026-08-17 note claiming curl also received CF 403 was measured through a predicate that read any HTML body as a Cloudflare block, including the mirror's own `502 upstream unreachable` page. The /api/v1 catalog does not fingerprint-block Bun fetch.",
    "2026-09-12: 429 joined that list. The release signoff's anime lane resolved a pewe stream that answered 429 to mpv, to curl with the stream's headers and to curl with none — a rate-limited master is refused to everyone, unlike the 403 that only Bun's fetch sees. Skipping it costs one server attempt; accepting it cost a failed play on the default anime provider. With pewe skipped the cycle lands on moo and plays (verified: 1080p frame).",
    "2026-09-12: rejected backends are recorded through context.endpointHealth as server-error against the server id, and the cycle skips a quarantined one without asking it. The probe also no longer asks animegg.org, whose /play never answers Bun's fetch (curl and mpv get a 302 at once): it spent the full timeout on every Moo resolve. Together they took a Miruro resolve from ~4.3s to ~1.1s once pewe was quarantined.",
    "Pipe-era error semantics: a 444/502 meant one of Miruro's backing servers was down (pewe follows AniDB, ally follows AllManga), not a WAF block — a backend down must still not stop the cycle on the catalog, since the remaining servers are usually healthy.",
  ],
});
