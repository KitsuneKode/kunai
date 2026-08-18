---
status: active
lastReviewed: "2026-08-18"
---

# User docs overhaul

> Phase 1 audit complete (2026-08-18). Code wins; this plan is intent.

**Goal:** Published docs a cold user can follow to install, play, and self-diagnose, with consistent client-not-host framing.

**PRs (split by workstream, against `main`):**

1. `docs/accuracy-and-framing` — wrong-and-shipping copy + disclaimer
2. `docs/first-run` — getting-started / install / PATH / mpv
3. `docs/debugging-playbook` — symptom → check → meaning → action
4. `docs/coverage-gaps` — YouTube, anime numbering/AniSkip, relay, tracker, Discord, downloads resume, surfaces
5. `docs/nav-and-readability` — `meta.json` order, dual-job splits, inbound links
6. `docs/agent-docs-routing` — `.docs/` stale paths (lower priority)
7. Deploy `apps/docs` to `kunai.kitsunekode.in`

## Global constraints

- Kunai is a client. It does not host, upload, mirror, seed, or distribute content.
- Never describe Kunai as providing, offering, or giving access to content.
- Production providers = `loadProductionProviderModules()` only.
- Do not hand-edit generated tables; fix source or `apps/docs/scripts/sync-code-metadata.ts`.
- `bun run test` never `bun test`.
- Canonical URL env is `DOCS_SITE_URL` (not `NEXT_PUBLIC_DOCS_SITE_URL`).
- Relay is metadata-only; `providerRelay.baseUrl` default empty; `videoFallback` has no production reader (K-04) — do not promise video relay.
- Analytics: explicit opt-in, five-key payload. Default `analyticsEndpoint` is already `""` and means “use the shipped URL”, not “disable”. Document that; do not treat empty config as a kill switch.

---

## 1. Wrong (fix first)

Verified against source. Each item is a shipping lie.

| ID  | Claim in docs                               | Reality                                                            | Files                                                                                                                      |
| --- | ------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| H1  | Fallback is `f`                             | `Shift+F`; browse `f` is favourite                                 | README, feature-tour, getting-started, what-you-can-do, playback-and-recovery, troubleshooting, providers, media-selection |
| H2  | Browse `Shift+F` opens filters              | Filters are `Ctrl+F` / `/filters`; Tab cycles series/anime/YouTube | getting-started, feature-tour                                                                                              |
| H3  | Playback `d` queues download                | `d` opens diagnostics                                              | README, feature-tour, what-you-can-do                                                                                      |
| H4  | Playback `m` is memory; FAQ `m` cycles mode | Live `m` is title control; memory is `/memory`; mode cycle is Tab  | runtime-feedback, README                                                                                                   |
| H5  | AllManga is automatic anime fallback        | `animeProviderPriority: ["anidb"]` only                            | providers.mdx, feature-tour, supported-and-unsupported, README (omits AniDB)                                               |
| H6  | Series order Videasy → VidLink → Rivestream | Videasy then `["rivestream", "vidlink"]`                           | providers.mdx                                                                                                              |
| H7  | npm requires Bun + postinstall              | Node launcher `dist/kunai.mjs`; no postinstall                     | getting-started, install-and-update, README, cli-reference                                                                 |
| H8  | Setup is six slides                         | Seven, including analytics                                         | README                                                                                                                     |
| H9  | Empty analytics URL disables send           | Falls through to default endpoint                                  | reliability-and-privacy.mdx, `.docs/analytics-privacy-contract.md`, `resolveAnalyticsEndpoint`                             |
| H10 | yt-dlp “online playback unaffected”         | YouTube resolve needs yt-dlp                                       | supported-and-unsupported.mdx                                                                                              |
| H11 | ImageMagick/chafa for posters               | Retired                                                            | README                                                                                                                     |
| H12 | `/docs` opens the docs site                 | GitHub `docs/` tree unless `KUNAI_DOCS_URL`                        | commands-and-shortcuts.mdx                                                                                                 |
| H13 | `/k` is a slash command; `k` opens tracks   | `k` is quality hotkey; `/source`                                   | media-selection, feature-tour, what-you-can-do                                                                             |
| H14 | `/random` on browse palette                 | Experimental, excluded                                             | README                                                                                                                     |
| H15 | Language-profile JSON as if defaults        | Defaults are `original` / `best`                                   | customization.mdx                                                                                                          |
| H16 | AllManga generated blurb “primary source”   | Manifest string; AniDB is default                                  | `allmanga/manifest.ts` then regenerate                                                                                     |
| H17 | Home featured `discover` / `queue`          | ids are `recommendation` / `up-next`                               | `home-presenters.ts`                                                                                                       |
| H18 | Loading footer `f fallback`                 | Binding is `⇧F`                                                    | `loading-shell-runtime.ts`, `run-mpv-playback-session.ts`                                                                  |
| H19 | `--continue` missing from generated flags   | Generator treats comma pair as short+long                          | `sync-code-metadata.ts`                                                                                                    |
| H20 | Tracker sync “works well”                   | Experimental                                                       | feature-tour                                                                                                               |
| H21 | `defaultMode` series or anime               | also `youtube`                                                     | customization.mdx                                                                                                          |

**Framing (same PR):**

- Canonical disclaimer on npm README; shared docs component; one click from `/`, `/docs`, users index, getting-started, providers.
- Rewrite “When to use” / “fast direct streams” / “scrapes” / “Search any title”.
- `hosted-streams` and `browser-providers` status: not `planned`.
- Provider table: no “recommended” badge; domains as text not outbound links.

## 2. Missing (write next)

| Topic                                                     | Where                             | Notes                                                                 |
| --------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| First-run PATH + mpv install commands                     | getting-started                   | Linux `~/.local/bin`; OS-split installer; `kunai doctor` on that page |
| Empty search / missing curl                               | troubleshooting                   | AniDB + curl                                                          |
| `/reset-provider-health`, `/clear-cache`, quarantine      | troubleshooting + providers       | Yesterday’s provider                                                  |
| Wyzie + `s` subtitle reload                               | media-selection + troubleshooting | zero hits in `docs/users` today                                       |
| Slowest startup stage                                     | diagnostics                       | 15s `fallback-first`                                                  |
| Failure-class table                                       | troubleshooting                   | map `userSummary` strings                                             |
| YouTube playlists/live/SponsorBlock                       | providers or new section          | `what-you-can-do` has zero YouTube                                    |
| Absolute vs seasonal episodes, AniSkip defaults           | playback / anime                  | `skipIntro: true`, `skipCredits: true`, cour 2+ MAL gap               |
| Relay stand-up for binary users                           | providers                         | metadata-only; no public URL; K-04 unused `videoFallback`             |
| Tracker outbox / fail-closed                              | customization or reliability      | do not call it production                                             |
| Discord client id vs README “just run Discord”            | customization + README            |                                                                       |
| Downloads resume-on-quit                                  | downloads-and-offline.md          | already in README                                                     |
| Surfaces: Watchlist vs Playlists vs Up Next vs Favourites | commands + getting-started        | ADR 0001                                                              |

## 3. Unclear (rewrite after)

- Getting-started dumps recipes/recovery before first play — cut to 1–5.
- Feature-tour / what-you-can-do / supported-and-unsupported overlap.
- reliability-and-privacy mixes analytics, recovery, and `bun run test`.
- Sidebar: playback before share-links; troubleshooting before glossary (`meta.json`).
- Contributor `bun run dev` recipes off user pages.
- Defaults beside every setting in customization.

## Owner decisions (do not guess)

1. **Windows player:** installer/doctor say `winget install mpv.net`; process looks for `mpv`. Docs will say the binary must be named `mpv`. Changing the winget id is a product PR.
2. **npm keywords** (`anime`, `movies`, `streaming`) — leave unless you want them dropped.
3. **`/docs` baked URL** after the site is live — set `KUNAI_DOCS_URL` / default to `https://kunai.kitsunekode.in` in a release, not only in prose.
4. **Empty analytics URL:** docs and the privacy contract will match code (empty config = shipped default; disable via Settings / DNT). No runtime change.
5. **Provider domain links** in the generated table — this plan renders them as text.

## Deploy traps (verified in tree)

- Vercel Root Directory `apps/docs` needs `outputFileTracingRoot` (already in `next.config.mjs`).
- Build-time `KUNAI_ANALYTICS_METRICS_URL=https://analytics.kunai.kitsunekode.in/metrics/daily.json`.
- Canonical origin: `DOCS_SITE_URL=https://kunai.kitsunekode.in`.
- Green build ≠ pages have content; check `/`, `/docs/users/getting-started`, `/releases`, `/analytics` after deploy.

## Evidence sources

Accuracy, coverage, first-run, debugging, legal, nav, readability, `.docs/` freshness audits (2026-08-18), plus coordinator checks of `defaults.ts`, `keybindings.ts`, `bootstrap-providers.ts`, `npm-launcher.mjs`, `ui.ts`, `resolveAnalyticsEndpoint`.
