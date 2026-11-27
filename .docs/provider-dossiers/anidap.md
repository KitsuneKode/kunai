---
status: current
lastReviewed: "2026-11-27"
---

# Anidap dossier

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/providers.mdx`.

## Identity and lane

- Config/provider id: `anidap`
- Lane: anime
- Site: `https://anidap.lol`
- Catalog API: `https://graphql.anidap.lol/graphql`
- Episode/server/source API: `https://chad.anidap.lol/rest/api`
- Production adapter: `packages/providers/src/anidap/direct.ts`
- Fixture suite: `packages/providers/test/anidap-direct.test.ts`

## Reverse-engineered contract

GraphQL root queries include `anime`, `searchAnime`, and `catalogAnime`; catalog rows are under connection `items`. A row's opaque `id` is the slug used by REST:

- `GET /rest/api/episodes?id={slug}`
- `GET /rest/api/servers?id={slug}&epNum={episode}`
- `GET /rest/api/sources?id={slug}&epNum={episode}&type=sub|dub&providerId={server}`

The adapter exposes sub and dub server slots separately, preserves provider-supplied media headers on the exact stream candidate, maps subtitle tracks, and keeps provider-native `ep:{number}` episode identities. It implements the public player's structural rewrites needed for relative/special lanes but does not use browser-only CORS proxies for ordinary direct HLS because mpv does not need browser CORS mediation.

## Live evidence — 2026-11-27

Capability audit in an isolated profile, with GraphQL search and REST episode listing exercised before resolve:

- Search: One Piece resolved to slug `one-piece-p8k27` (20 results); Dandadan resolved to `dan-da-dan-khp5m` (3 results).
- Episode catalogs: One Piece returned 1,180 rows; Dandadan returned 12 rows, both with provider-native `ep:{number}` identities.
- Resolve/probe: 3/4 cases resolved and independently probed reachable. One Piece episode 1 sub, Dandadan episode 1 sub, and Dandadan episode 1 dub succeeded; One Piece episode 1 dub hit the balanced 12 s provider-attempt timeout. That is evidence of a slow/fragile lane, not proof that the dub slot is absent.
- Decode: mpv `--vo=image` wrote `/var/tmp/kunai-batch1-frames/anidap-one-piece-e1-sub.png`; the PNG was opened and confirmed as real 1920x1080 video.
- Successful resolve latency measured in the audit: 5.81-9.65 s; independent probes took 2.09-2.19 s.
- Sub servers inventoried: `nero`, `yuki`, `zuna`, `sora`. Dub servers inventoried: `nero`, `yuki`, `sora`.
- Quality: server rows report `auto` adaptive HLS rather than explicit static renditions.
- Audio: Japanese for sub rows; English for the successful Dandadan dub row.
- Subtitles: 17 ISO-normalized languages were measured across the successful lanes, including English, Arabic, German, Spanish, French, Indonesian, Italian, Japanese, Korean, Polish, Portuguese, Russian, Thai, Filipino, Turkish, Vietnamese, and Chinese. The live `may` bibliographic Malay code exposed by one upstream row is normalized to ISO 639-1 `ms`.
- Media CDNs measured: `s-91.megavid.se`, `fetch.nexabloom.top`, `hls.dramahot.top`, `bl.krussdomi.com`, and `hls.krussdomi.com`.
- Required headers measured: Nero uses `Referer: https://animex.one/`; Yuki uses Megaplay origin/referer headers; Zuna uses ZokoAnime referer headers; Sora uses the KAA-style mobile headers.

The unsuccessful One Piece dub attempt was not retried into a decoded frame, so dub support is verified by Dandadan rather than by both fixtures.

## Independence assessment

Anidap is **not** wholly independent. `zuna` uses `hls.dramahot.top`, the same ZokoAnime media family as HiAnime; `sora` uses `bl.krussdomi.com`, the same Krussdomi/CatStream family as KickAssAnime. The Nero (`megavid.se` / AnimeX) and Yuki (`nexabloom.top` / Megaplay) lanes are distinct from the currently measured production backends, so Anidap adds partially independent capacity rather than a clean independent backend.
