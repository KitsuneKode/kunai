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

Title: One Piece, AniList/MAL `21`, slug `one-piece-p8k27`, episode 1 sub.

- Resolve: `resolved`, 4 sub candidates.
- Probe: shared resolve gate reachable. Manual playlist probes for Nero/Yuki/Dub Nero returned HTTP 200 `application/vnd.apple.mpegurl` and `#EXTM3U` before implementation.
- Decode: mpv `--vo=image` wrote `/tmp/kunai-batch1-live/audit-frames-r2/anidap-one-piece-e1-sub.png`; opened and confirmed as real 1920x1080 video.
- Sub servers: `nero`, `yuki`, `zuna`, `sora`.
- Dub servers listed upstream: `nero`, `yuki`, `sora` (One Piece episode 1 has dub).
- Quality: server rows report `auto` adaptive HLS rather than explicit static renditions.
- Audio: Japanese for sub; English for dub rows when selected.
- Subtitles: English VTT on Yuki/Zuna in the measured sub lane; recorded dub Nero also advertised English, Thai, Vietnamese, and Indonesian.
- Media CDNs measured: `s-91.megavid.se`, `fetch.nexabloom.top`, `hls.dramahot.top`, `bl.krussdomi.com`; subtitle CDN `315nk.distantdaydreams.org`.
- Required headers measured: Nero `Referer: https://animex.one/`; Yuki `Origin/Referer: https://megaplay.buzz`; Zuna `Referer: https://zokoanime.video/`; Sora uses a KAA-style mobile user agent/referer.
- Latency in the capability audit: 5.96-7.55 s across One Piece and Dandadan sub/dub; all 4 cases resolved and probed.

## Independence assessment

Anidap is **not** wholly independent. `zuna` uses `hls.dramahot.top`, the same ZokoAnime media family as HiAnime; `sora` uses `bl.krussdomi.com`, the same Krussdomi/CatStream family as KickAssAnime. The Nero (`megavid.se` / AnimeX) and Yuki (`nexabloom.top` / Megaplay) lanes are distinct from the currently measured production backends, so Anidap adds partially independent capacity rather than a clean independent backend.
