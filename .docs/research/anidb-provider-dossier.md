# AniDB (anidb.app) Provider Research Dossier

## Request Summary

- Provider: AniDB (`anidb.app`)
- Requested by: KitsuneKode (ani-cli v5 parity)
- Date: 2026-08-01
- Goal: New anime provider matching ani-cli 5.0 primary source
- Success criteria: search → episode list → HLS stream resolve via Kunai direct-http

## Inputs Supplied By Developer

- Sample titles / URLs: `https://anidb.app/browse?q=demon%20slayer`, show `onigiri-3942`
- Known requirements: Chrome UA; curl preferred (Bun fetch often CF 403)
- What already works: full path probed with system curl on this machine
- Reference: `~/Projects/osc/ani-cli` at v5.0.0 (`a6ac602` / `8caa4ee`)

## Scope

- Content types: anime series only
- Features: search, episode list, sub/dub language embeds, HLS quality ladder

## Known

- Search: `GET /browse?q=%s` HTML; parse `anime/{slug}-{id}` + `alt="title"`
- Episodes: `GET /api/frontend/anime/{numericId}/episodes` → `{episodes:[{id,number,filler}]}`
- Languages: `GET /api/frontend/episode/{epId}/languages` → `embed_url` per `jpn` / `eng`
- Embed HTML: `file: 'https://hls.anidb.app/.../master.m3u8'`
- HLS master expands to ranked variants; media host works with Bun fetch
- Sub = `jpn`, dub = `eng` (ani-cli parity)
- MAL id available on `/anime/{slug}` page

## Suspected

- Some regions may need curl-impersonate (ani-cli dies on "Just a moment")
- Season picker on anime pages exists but is optional for v1

## Unknown

- Whether CF challenge frequency varies by ASN
- Full subtitle inventory (hardsubs assumed for jpn embeds)

## Runtime Contract Recommendation

- Provider id: `anidb`
- Catalog: provider-native (`slug-numericId`)
- Runtime: direct-http, local-only, curl UA fallback for site/API/embed
- Default anime priority: primary ahead of AllManga while mkissa GraphQL remains CF-sensitive

## Sample Cases

| Title   | Show id      | Ep  | Audio | Result                         |
| ------- | ------------ | --- | ----- | ------------------------------ |
| Onigiri | onigiri-3942 | 1   | sub   | HLS master + 1080/720 variants |

## Open Questions For Later

- Title bridge from AniList → AniDB without search fuzzy match
- Season change UX parity with ani-cli `change_season`
