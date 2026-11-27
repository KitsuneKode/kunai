---
status: active
created: "2026-11-28"
lastReviewed: "2026-11-28"
---

# Plan: Stremio-like client and surface for everyone

## Status

- **Status:** ACTIVE. Sets the product direction adopted on 2026-11-28: Kunai
  evolves into a polished, Stremio-like media client and surface for everyone —
  best-in-class UI/UX paired with user-installed addon sources — focused on what
  users feel rather than maintaining a fragile list of bundled scrapers.
- **Hard legal boundary (non-negotiable):** Torrent streaming, magnet playback,
  and debrid integrations (e.g., WebTorrent, Real-Debrid, AllDebrid) stay
  **strictly out of Kunai's own code**. An addon a user chooses to install may
  serve HTTPS stream URLs produced however that addon operates; Kunai itself
  ships zero addons, zero torrent engine, zero magnet handler, and zero debrid
  client.
- **Owns:** the concrete Stremio-like product target, gap priority order across
  addons/sources/playback/library/cross-device/UX, and the triage of unmerged
  branches and dirty worktrees (Appendix).
- **Connects to:**
  [2026-11-23-provider-platform.md](./2026-11-23-provider-platform.md) (catalog
  contract, packs, legal posture),
  [2026-11-24-road-to-9-5.md](./2026-11-24-road-to-9-5.md) (per-dimension
  quality bar),
  [2026-11-24-players-vlc-iina-and-mobile-order.md](./2026-11-24-players-vlc-iina-and-mobile-order.md)
  (player backends and mobile sequencing),
  [2026-11-25-security-and-improvement-review.md](./2026-11-25-security-and-improvement-review.md)
  (M2 addon connection split and L1 mpv argv), and
  [2026-11-27-launch-and-retention.md](./2026-11-27-launch-and-retention.md)
  (v0.4.0 launch sequence and retention wins).

## What "Stremio-like" means for Kunai

Stremio won mainstream adoption with two ideas: **a clean, unified media client**
(Board, Discover, Library, Calendar, Detail view, Source picker) decoupled from
**user-installed HTTP JSON addons**. Kunai already has stronger playback
engineering than Stremio's desktop client (mid-stream failover at the same
timestamp, decoded-video readiness gating, mpv + VLC support, IntroDB/AniSkip
auto-skip, local-first privacy, zero ads). Becoming "Stremio-like for everyone"
means keeping that playback engine while closing the gaps users feel in the
first five minutes:

1. **Addon-first source ecosystem.** Installing an addon takes seconds, requires
   no restart, supports HLS/DASH and subtitles safely, and can power catalogs,
   metadata, streams, and subtitles — while Kunai bundles zero addons and zero
   torrent/debrid code.
2. **Scannable source picker + effortless playback.** Users can either press
   Enter for instant verified autoplay or pick from a clean, badged list of
   streams across enabled addons and providers (addon name, resolution, HDR/DV,
   audio/subtitle language, health). Chosen audio and subtitle tracks survive
   failover and episode transitions.
3. **Home that brings you back.** Opening Kunai surfaces Continue Watching (with
   release-backed next-episode promotion), New Episodes Since You Left, and
   non-empty Discover/Board rails backed by durable caches and addon catalogs.
4. **One unified Library with portable sync.** Watchlist, Favorites, Playlists,
   History, and Offline Downloads live in one cohesive Library, syncing cleanly
   with AniList, TMDB, and Trakt — plus local export/import so users move their
   setup across devices without a Kunai cloud account.
5. **Surfaces for everyone, not just terminal purists.** The Ink TUI stays fast
   and first-class, while a local web companion (`kunai serve`) brings a
   poster-rich Netflix/Stremio-grade UI to browsers and phones backed by the
   exact same local Kunai engine — plus Android handoff (including offline files)
   and Chromecast/Google Cast for the living room.
6. **UI/UX craft bar (vs. Stremio, Netflix, Crunchyroll).** Every screen obeys
   one visual, focus, loading, empty, and error grammar; jargon stays in
   `/diagnostics`; posters, progress bars, and next-up cues look intentional.

### Quality bar comparison: Kunai today vs. Stremio, Netflix, Crunchyroll

| Dimension          | Where Kunai already wins on `main`                                                                                                  | Where Stremio / Netflix / Crunchyroll beat Kunai today                                                                           | Target bar for Kunai                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Playback core**  | Mid-stream failover at same timestamp (`PersistentMpvSession.ts`), decoded-frame gate (`playback-output-gate.ts`), mpv + VLC, skip  | Seamless audio+subtitle persistence across streams; wide TV/cast/mobile player reach; addon HLS/DASH playback                    | Audio + subs survive failover; addon HLS/DASH via gateway (M2); IINA + Cast A/V; first URL off mpv argv (L1)                                       |
| **Addon sources**  | Safer protocol client (`packages/providers/src/stremio-addon/`): SSRF/DNS-pinned, schema-bounded, `verifyCandidateStream`, scrubbed | One-click install + hot-reload; `/catalog`, `/meta`, `/stream`, `/subtitles`; anime addons; HLS/DASH support; addon directory UX | Hot-reload install + `kunai://` / `stremio://` deep-link import; full `/catalog`/`/meta`/`/stream`/`/subtitles`; gateway confinement; vault URLs   |
| **Source picker**  | Automatic priority + health-ranked fallback (`PlaybackResolveService.ts`, `SourceSelectionEngine`) + mid-play Tracks overlay        | Stremio's pre-play stream list grouped by addon with 4K/HDR/audio/size badges right beside the episode                           | Opt-in or on-demand aggregated pre-play source picker with addon, resolution, HDR, and audio/sub badges + instant Enter autoplay default           |
| **Home & return**  | Zero-ad, instant keyboard Home with release-backed next-episode row (`release-next-episode.ts`, `browse-idle-context.ts`)           | Netflix/Crunchyroll auto-follow after first watch, rich poster rows, never-blank Discover rails, clear visual progress bars      | Auto-follow past 30s watch; actionable cold-cache Discover; stale-while-revalidate + addon catalog rails; prominent progress & "New Episode" cues  |
| **Library & sync** | Local SQLite ownership (`packages/storage/src/repositories/`), AniList + TMDB sync, session undo (`z`), offline downloads           | Stremio's Trakt scrobbling + instant cross-device addon/library sync; Crunchyroll's crisp watchlist/crunchylists                 | Trakt sync adapter; portable local profile export/import; gateway-safe addon offline downloads; deterministic FIFO download queue                  |
| **Surfaces & UX**  | Keyboard velocity, pointer controls (`app-shell/mouse/`), Kitty/iTerm2/Sixel posters (`apps/cli/src/image/`), plain screen-reader   | Graphical poster grids anyone can use without learning terminal shortcuts; phone + TV apps; calm, uncrowded chrome               | Shell v4 unified grammar + calm visual hierarchy; `kunai serve` graphical web companion for desktop/phone browsers; Android offline handoff + Cast |
| **Privacy/legal**  | Opt-in-only analytics, local-first SQLite, metadata-only relay, zero bundled addons, zero torrent/debrid code                       | Netflix/Crunchyroll are licensed; Stremio keeps scrapers/torrents strictly inside third-party addons                             | Own TMDB key (`KUNAI_TMDB_BUILD_KEY`); fail-closed relay enforcement; no-scrapers build flavour (platform Decision 2b); zero torrent/debrid code   |

## What exists today on `main`

Every capability below is verified in the current `main` tree:

- **Stremio addon client (experimental, stream-only):**
  `packages/providers/src/stremio-addon/{protocol,addon-url,client,streams,module}.ts`,
  `apps/cli/src/domain/provider/stremio-addons.ts`,
  `apps/cli/src/services/providers/{stremio-addon-modules,run-addons-command}.ts`,
  `apps/cli/src/app-shell/settings/registry/addons.ts`, wired in
  `apps/cli/src/container/bootstrap-providers.ts`. Off by default behind
  `experimentalStremioAddons` + `stremioAddonsRiskAcknowledgedAt`
  (`packages/config/src/types.ts`). Currently movies/series only (by IMDb id),
  direct MP4/MKV only (`requireDirectMedia` in
  `packages/providers/src/shared/stream-reachability.ts` refuses HLS/DASH and
  redirects), desktop mpv only (Android handoff and `DownloadService` reject
  addon provenance), URLs stored in `config.json` (not vaulted), and newly added
  addons require a restart to load.
- **Provider engine, toggles, health, and hotfix manifest:**
  `packages/core/src/provider-engine.ts`,
  `packages/core/src/provider-cycle-engine.ts`,
  `apps/cli/src/services/playback/PlaybackResolveService.ts`,
  `apps/cli/src/services/providers/{ProviderRegistry,provider-priority,provider-hotfix-manifest}.ts`,
  `apps/cli/src/domain/provider/provider-switches.ts`,
  `apps/cli/src/app-shell/settings/registry/providers.ts`,
  `apps/cli/src/app-shell/workflows/shell-workflows.ts` (`handleProvidersHub` /
  `handleProviderToggles`). Manual provider switches are fail-closed across
  cache replay, inventory replay, and primary dispatch.
- **Playback, failover, players, and gateway:**
  `apps/cli/src/infra/player/PersistentMpvSession.ts`,
  `apps/cli/src/infra/player/playback-output-gate.ts`,
  `apps/cli/src/infra/player/vlc/vlc-player-service.ts`,
  `apps/cli/src/infra/player/stream-gateway.ts` (loopback-only, per-playback
  token, SSRF/DNS-pinned header injection + HLS/DASH rewriting),
  `apps/cli/src/infra/player/handoff-player-service.ts` (Android external-player
  handoff; currently rejects local files with `local-source-unsupported`),
  `apps/cli/src/infra/timing/` (IntroDB/AniSkip), `apps/cli/src/subtitle.ts`,
  `apps/cli/src/app/playback/tracks-panel-pick.ts`,
  `apps/cli/src/app/playback/playback-stream-acquire.ts`.
- **Catalog, Home return loop, Library, and Sync:**
  `apps/cli/src/services/catalog/{catalog-source,tmdb-proxy}.ts`,
  `apps/cli/src/services/continuation/release-next-episode.ts`,
  `apps/cli/src/app-shell/{browse-shell.tsx,browse-idle-context.ts,browse-idle-actions.ts,return-loop-copy.ts}`,
  `apps/cli/src/app-shell/hooks/use-dwell-prefetch.ts`,
  `apps/cli/src/app-shell/mouse/`, `apps/cli/src/image/`,
  `packages/storage/src/repositories/{history,lists,playlists,queue,followed-titles,notifications,offline-assets,download-jobs,catalog-crosswalk}.ts`,
  `apps/cli/src/services/sync/{SyncService,AniListAdapter,TmdbAdapter}.ts`,
  `apps/cli/src/services/download/DownloadService.ts`,
  `apps/cli/src/domain/undo/session-undo-journal.ts`.
- **Cross-device & distribution foundations:**
  `apps/mobile/src/entry.ts` (Termux + a-Shell host proofs),
  `apps/cli/src/domain/share/` (`kunai://` share links),
  `apps/cli/src/services/persistence/{config-vault-fields,credential-vault-backends}.ts`
  (OS vault with macOS `security -i` stdin and Windows `PasswordVault` probe),
  version-bound Ed25519 release signing (`scripts/packaging/release-supplements.ts`,
  `.github/workflows/package-channels.yml`,
  `apps/cli/test/integration/signed-installers.test.ts`),
  metadata-only relay (`packages/relay/src/create-relay-fetch-port.ts`,
  `doh-transport.ts`, `pinned-transport.ts`).

## Gaps in priority order (Phases 0–4)

### Phase 0 — Security, trust & legal foundations (unblocks first-class addons)

1. **Route Stremio addon playback through the loopback stream gateway (closes M2, unlocks HLS/DASH).**
   Extend `apps/cli/src/infra/player/stream-gateway.ts` so every addon stream —
   direct MP4/MKV, HLS `.m3u8`, and DASH `.mpd` — is fetched on Kunai's pinned,
   SSRF-checked connection instead of letting mpv re-resolve the addon hostname.
   Keep redirects refused or re-checked per hop. This simultaneously resolves
   security finding M2 in
   [2026-11-25-security-and-improvement-review.md](./2026-11-25-security-and-improvement-review.md)
   and removes the largest real-world Stremio addon compatibility barrier (most
   direct-HTTP Stremio addons serve HLS).
2. **Move Stremio addon URLs into the OS credential vault.**
   Configured Stremio manifest URLs frequently embed user tokens in their path.
   Store the raw URL behind `apps/cli/src/services/persistence/config-vault-fields.ts`
   with only the host + provider id + metadata in `config.json`, matching
   `tmdbApiKey` and `providerRelay.token`.
3. **Keep first media URL off mpv argv (L1) and ship Kunai's own TMDB key.**
   Start mpv idle and load the first media URL via IPC (`PersistentMpvSession.ts`),
   configure `KUNAI_TMDB_BUILD_KEY` in releases, and remove the borrowed TMDB
   key from `apps/cli/src/services/catalog/tmdb-proxy.ts`.
4. **Fix relay fail-closed leak (`fallbackToDirect: false`).**
   **Slots Task A #5 (`release/p1-relay-providers`):** Port typed
   `RelayRefusalError`, adapter terminal propagation, and the
   `relay-unreachable` / `relay-refusal-adapters` test suites onto current `main`
   so an unreachable pinned relay can never fall through to direct
   `curl_chrome136`.

### Phase 1 — Core user-felt polish, quick salvages & storefront

1. **Salvage the 4 verified bug fixes from the `kitsunesnipe-main` dirty worktree (strictly excluding all torrent/debrid code).**
   **Slots Task A #6a (salvage subset):**
   - Pipe mpv `stderr` when `--mpv-debug` is active (`apps/cli/src/infra/player/PersistentMpvSession.ts`).
   - Capture `mpvFileError` on `end-file` for diagnostics (`apps/cli/src/infra/player/mpv-stats.ts`).
   - Monotonic enqueue timestamps for deterministic FIFO download queues (`apps/cli/src/services/download/DownloadService.ts`).
   - Half-open quarantine canary so a 100%-quarantined provider pool can recover (`packages/core/src/provider-cycle-engine.ts`).
     _(Note: its old `apps/cli/src/app-shell/search-history.ts` write-serialization fix was superseded on `main` when the file was removed and replaced by cross-process locked `apps/cli/src/services/persistence/search-history.ts`.)_
2. **Carry chosen audio track across failover.**
   **Slots Task A #1 (audio slice from `fix/desktop-android-companion-20261104`):**
   Rework `mpv-audio-intent` + `apps/cli/assets/mpv/kunai-bridge.lua` onto current
   `main` so audio preference matches subtitle carryover across failover and
   multi-audio MKV/HLS streams.
3. **Retention loop quick wins (from launch plan).**
   Auto-follow on first real watch (>30s) unless muted; actionable search/retry
   empty state for cold-cache Discover; durable stale-while-revalidate cache for
   trending/discover/recommendations.
4. **Storefront & launch assets.**
   - **Slots Task A #4e (PR #716 `feat/docs-seo-geo-indexing`):** Land SEO/GEO,
     `/llms-full.txt`, RSS/Atom feeds, and comparison guide (add Stremio-addon
     positioning).
   - **Slots Task A #4d (PR #760 `docs/sumi-sakura-web-skin`):** Land the Sumi &
     Sakura docs/landing redesign after refreshing hero and `provider-directory`
     copy to lead with the addon-based client and legitimate sources rather than
     promoting third-party scrapers.
   - **Slots Task A #3 (`feat/demo-recording-pipeline`):** Land `tools/demo/`
     harness and encode profiles, replacing live-scraper hero scenes with a
     controlled local-endpoint failover + Stremio addon clip for the README.

### Phase 2 — First-class Stremio addon UX & aggregated source picker

1. **Hot-reload addon lifecycle & frictionless install.**
   Rebuild/refresh addon provider modules inside `ProviderRegistry`
   (`apps/cli/src/services/providers/ProviderRegistry.ts`) without restarting
   Kunai when the user adds, removes, or toggles an addon. Add manifest preview
   (capabilities, types, id prefixes, host) before confirming install, plus
   `kunai://addon` / `stremio://` deep-link handoff into the install prompt.
   Promote Stremio addons out of hidden `experimentalStremioAddons` once Phase 0
   gateway + vault protections are active (keeping zero bundled addons and
   first-install risk consent).
2. **Aggregated Stremio-style pre-play source picker.**
   Add a clean, optional (configurable: `auto-play` vs `ask-sources`, plus
   explicit keybinding from title/episode detail) source picker that queries
   enabled addons + providers in parallel and groups playable streams with clear
   badges: addon/source name, resolution (`4K`/`1080p`/`720p`), HDR/DV, audio
   language/dub, subtitle count, and probe health. Pressing Enter from browse
   still respects instant autoplay when configured; picking a specific stream
   persists source preference and feeds directly into failover.
3. **Full Stremio protocol resources: `/catalog`, `/meta`, `/subtitles`, and anime mapping.**
   - **`/catalog`:** Adapt addon-declared catalogs into `CatalogSource`
     (`apps/cli/src/services/catalog/catalog-source.ts`) so user addons can
     contribute Home/Discover rails and search results alongside TMDB/AniList.
   - **`/meta`:** Fall back to addon `/meta` for titles/episodes not in TMDB.
   - **`/subtitles`:** Consume standalone Stremio subtitle addons through the
     existing desktop subtitle fetch boundary (`apps/cli/src/subtitle.ts`).
   - **Anime addons:** Add an offline AniList↔Kitsu/IMDb id map into
     `packages/storage/src/repositories/catalog-crosswalk.ts` so Stremio anime
     addons work in `-a` anime mode without per-request scraping.
4. **Legitimate first-class sources & no-scrapers build flag.**
   Add local video file playback (with history/resume), an Internet Archive
   adapter behind `verifyCandidateStream`, and a clean build flag to omit
   bundled scrapers (`apps/cli/src/container/bootstrap-providers.ts`), matching
   Decision 2b in [2026-11-23-provider-platform.md](./2026-11-23-provider-platform.md).
5. **Shell v4 visual coherence & player parity.**
   Unify loading/error/empty/focus grammar across `apps/cli/src/app-shell/*`,
   land VLC live track switching + IINA backend
   ([2026-11-24-players-vlc-iina-and-mobile-order.md](./2026-11-24-players-vlc-iina-and-mobile-order.md)),
   and lift the `DownloadService` block for gateway-confined addon streams.

### Phase 3 — Cross-device surfaces & portable library

1. **Local Web Companion (`kunai serve`) — graphical Stremio-like UI for everyone.**
   **Slots Task A #1 (web companion slice from `fix/desktop-android-companion-20261104`, reworked):**
   Expose a loopback-first (with opt-in authenticated LAN mode) local HTTP API
   and polished browser PWA serving Home (Continue Watching, New Episodes,
   Discover/Addon catalogs), Search, Detail + Source Picker, Library, Addon
   Manager, and remote/direct playback launchers (local mpv/VLC control on
   desktop, VLC/Infuse/Outplayer scheme handoff on phones). Keep web companion
   UI assets inside `apps/cli` or a dedicated UI package — **never** in
   `packages/relay`, which remains strictly metadata-only. This gives
   non-terminal users a Netflix/Stremio-grade visual surface backed by the exact
   same Bun engine, SQLite DB, and addon stack.
2. **Android offline handoff & gateway-backed addon playback on phone.**
   **Slots Task A #1 (Android offline slice from `fix/desktop-android-companion-20261104`, reworked):**
   Rework local-file Range serving into `apps/cli/src/infra/player/stream-gateway.ts`
   and `apps/cli/src/infra/player/handoff-player-service.ts` so downloaded
   episodes play in Android external players, and allow gateway-confined addon
   streams on Android after physical-device qualification (#631).
3. **Trakt sync & portable profile export/import.**
   Add `TraktAdapter` alongside `apps/cli/src/services/sync/AniListAdapter.ts`
   and `TmdbAdapter.ts`, plus encrypted/opt-in profile export/import (addon list,
   library, watch history) for multi-device continuity with zero Kunai cloud
   backend.
4. **Google Cast A/V playback for the living room.**
   **Slots Task A #2 (`pr-306`, reworked — A/V Cast only; drop split-audio):**
   Port mDNS/DIAL/Avahi discovery, Cast V2 TLS client, and Cast subtitle serving
   onto `PlayerService` + `PlayerCapabilities`, reusing `stream-gateway.ts`'s
   SSRF/DNS-pinning guard with explicit LAN token scoping.

### Phase 4 — Polish & optional delight

1. **Thin native mobile/TV shell over `kunai serve`** (only after Phase 3 web
   companion + physical Termux pass prove the local API; never port providers to
   Kotlin/Swift).
2. **Optional docs visual craft:** Cherry-pick the isometric resolve-gate
   diagram (`apps/docs/components/iso/resolve-gate/` on `docs/kanna-stay`,
   **Task A #4f**) onto the Sumi & Sakura site once PR #760 is stable.

---

## Appendix: Unmerged Branches & Dirty Worktrees Triage (Task A)

All branches and worktrees below were inspected read-only against `origin/main`
(`accfbae87`, 2026-11-27).

### Summary table

| Item                                                             | Branch / Worktree                                                         | Already on `main`                               | Fit w/ Stremio-like direction               | Cost to land on `main`                              | Top risks (legal / privacy / maint)                                                                 | Recommendation & rough order                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **1. Web companion + `serve` + Android offline + desktop audio** | `fix/desktop-android-companion-20261104` (closed #677; local `64823f162`) | Loopback `stream-gateway.ts` only (~15%)        | **High** (3 core slices); **No** (debrid)   | **High** as-is; **Small–Med** as 3 split rework PRs | **Legal:** branch history bundles Real-Debrid/AllDebrid magnets; **Boundary:** HTML in `relay`      | **Rework (split into 3 PRs, drop debrid):** Audio P1 → Android offline P3 → `serve` P3 |
| **2. Google Cast playback backend**                              | `pr-306` (`c1742a1aa`, base 2026-09-01)                                   | None; `main` has `PlayerService`+gateway        | **Med–High** (A/V Cast); **Low** (split)    | **High** (1–2 wks; 3-mo old arch, pre-W2)           | **Security:** LAN gateway needs SSRF/DNS-pinning; **Maint:** ~2k LOC, no HW CI, Custom Receiver     | **Rework (A/V Cast only onto `PlayerService`; drop split-audio):** P3                  |
| **3. Demo recording pipeline**                                   | `feat/demo-recording-pipeline` (`7d1f5f75d`, base 2026-09-02)             | None (`tools/demo/` absent on `main`)           | **Medium** (enables README/failover demos)  | **Low** (1–2 days; self-contained in `tools/demo/`) | **Legal:** hero scenes film live scrapers (swap to owned/local endpoints); **Maint:** Hyprland      | **Land (rework hero scenes to local endpoints):** P1 (launch-adjacent)                 |
| **4a. Workshop link previews**                                   | `feat/workshop-link-previews-20261027` (closed #673; local `3771eb022`)   | **100%** of website work is on `main`           | N/A (website already shipped)               | Low (only 4 local QA/shell commits remain)          | Unrelated local QA/lint commits mixed onto closed docs branch                                       | **Drop** (optionally check `b569a8674` Esc/Tab shell fix during Shell v4)              |
| **4b. Workshop landing & tooling snapshot**                      | `wip/workshop-landing-and-tooling-20261122` (`31ec9a5e2`, backup tag)     | Skin in #760; `sign-provider-manifest.ts`       | N/A (mixed 468-file backup snapshot)        | Prohibitive (stale pre-W1–W6 CLI snapshot)          | Severe regression risk if merged                                                                    | **Drop** (keep as backup snapshot only)                                                |
| **4c. Web design inspiration**                                   | `docs/web-design-inspiration` (`a3d171d86`)                               | Ancestor of PR #760 (0 unique commits)          | Superseded by PR #760                       | N/A                                                 | Duplicate of #760 without review/mobile fixes                                                       | **Drop** (superseded by PR #760)                                                       |
| **4d. Sumi & Sakura web skin**                                   | Open PR #760 (`docs/sumi-sakura-web-skin`, `3f2e355c8`, base 2026-11-26)  | None on `main`                                  | **High** (polished storefront; tweak copy)  | **Low–Med** (1–2 days; fresh base, copy refresh)    | **Legal:** interactive `provider-directory` highlights scrapers; **Maint:** ~8k LOC custom UI       | **Land (after addon-first copy refresh):** P1 (storefront)                             |
| **4e. Docs SEO, GEO & indexing**                                 | Open PR #716 (`feat/docs-seo-geo-indexing`, `603050f2b`, base 2026-11-22) | Basic `llms.txt`/`robots`/`sitemap` only        | **High** (organic & AI-search discovery)    | **Low** (0.5–1 day rebase)                          | Low; ensure comparison/JSON-LD copy matches addon-first posture                                     | **Land:** P1 (first docs merge)                                                        |
| **4f. Kanna stay + isometric diagrams**                          | `docs/kanna-stay` (`76b367976`, base 2026-10-03)                          | Partial (`workshop`, `provider-status`)         | **Low–Med** (heavy clash with #760 skin)    | **High** (4–6 days; 2-mo old, conflicts w/ #760)    | **Maint/Perf:** ~2.5k LOC custom physics/iso/mascot; `ask-ai-panel` scope                           | **Drop branch** (optionally cherry-pick `iso/resolve-gate/` in P4)                     |
| **5. Relay fail-closed tests & error type**                      | `release/p1-relay-providers` (`45681e600`, base 2026-10-08)               | Port has `fallbackToDirect` (~40%); gaps        | **Medium** (privacy guarantee for relay)    | **Low–Med** (1–2 days to port error+tests only)     | **Privacy:** without typed `RelayRefusalError`, adapters can fall through to direct `curl`          | **Rework (port `RelayRefusalError` + fail-closed tests only; drop rest):** P0          |
| **6a. Dirty worktree `kitsunesnipe-main`**                       | `docs/community-license-rfc` (57 changed/untracked files)                 | `search-history.ts` superseded; 4 fixes missing | **Mixed:** 4 fixes **High**; torrent **No** | **Low** (1 day to salvage 4 clean fixes only)       | **Severe legal risk:** untracked `webtorrent` + Real-Debrid code wired into `/torrent`              | **Rework (salvage 4 fixes; strictly DROP torrent/debrid & Oct-13 scrapers):** P1       |
| **6b. Dirty worktree `release/distribution-and-signing`**        | `t3-e79bfa6c-...` (HEAD `d4cd71246`, 24 mod + 4 untracked)                | **~100%** landed stronger on `main`             | Superseded                                  | N/A                                                 | **Security regression** if applied (weakens `main`'s version-bound Ed25519 manifest signing)        | **Drop** (superseded on `main`; clean up after `wip:backup`)                           |
| **6c. Dirty worktree `providers/health-pass`**                   | `t3-30d0f926-...` (HEAD `f6c468110`, 17 mod files)                        | **100%** landed & passed by rev 8 (#841)        | Superseded                                  | N/A                                                 | Regresses `providerDefaultsRevision` from 8 back to 7                                               | **Drop** (superseded by #745, #841, #845; clean up after `wip:backup`)                 |
| **7a. Provider toggles (closed #636)**                           | `origin/feat/provider-toggles` (`39d195110`, base Oct 13)                 | **100%** of behavior on `main` (better)         | Already shipped                             | N/A                                                 | Unmatched ~26–30% are refactored/superseded lines; branch throws on all-disabled lane (`main` safe) | **Drop**                                                                               |
| **7b. YouTube resilience (closed #637)**                         | `origin/feat/youtube-resilience` (`23493323c`, stacked on #636)           | **100%** of `35fc508cd` verbatim on `main`      | Already shipped                             | N/A                                                 | Unmatched lines are parent #636 delta + 3-line test date tweak in `panel-data.test.ts`              | **Drop**                                                                               |

### Detailed triage notes

#### 1. Local web companion + `serve` + Android offline handoff (`fix/desktop-android-companion-20261104`, closed #677)

- **User value:** Delivers three real capabilities: (a) `kunai serve` with a
  Sakura-styled mobile/desktop PWA companion (on branch:
  `packages/relay/src/web-companion-html.ts` and
  `apps/cli/src/services/web-companion/*` — not on `main`), authenticated via
  per-run secret with `/api/session`, `/api/control`, `/api/release`, and direct
  VLC/Infuse/Outplayer launchers; (b) Android offline file handoff with HTTP
  Range support (on branch: `local-gateway-file.ts` — not on `main`); and (c)
  embedded audio-language intent carried across mpv sessions/failover (on
  branch: `mpv-audio-intent.ts` + `kunai-bridge.lua` — not on `main`).
- **Already on `main`:** `apps/cli/src/infra/player/stream-gateway.ts` and
  `apps/cli/src/infra/player/handoff-player-service.ts` exist on `main`, but
  `handoff-player-service.ts` explicitly rejects local files with
  `HandoffPlaybackError("local-source-unsupported")`. None of the web companion
  or audio-intent files exist on `main`.
- **Why rework instead of land:** The branch has 473 changed files against an
  Oct 27 merge-base (`f3d2b5acd`) and includes Real-Debrid / AllDebrid magnet
  playback commits (`176fa2ae1`, `62490dfc2`, `d9e714607`) that violate Kunai's
  legal boundary. Additionally, placing `web-companion-html.ts` inside
  `packages/relay` blurs the metadata-only relay boundary; move companion UI
  under `apps/cli` (or a dedicated UI package) when reworking.

#### 2. Google Cast playback backend (`pr-306`)

- **User value:** Casts resolved direct or header-protected HLS/DASH streams to
  Chromecast/Google TV via `--cast [device]`, `--cast-list`, and experimental
  `--cast-audio [device]` (on branch: `apps/cli/src/services/playback/cast/*` —
  not on `main`).
- **Already on `main`:** Zero Cast files are on `main`, while `main` has since
  built `PlayerService`/`PlayerCapabilities`, desktop VLC
  (`apps/cli/src/infra/player/vlc/vlc-player-service.ts`),
  `apps/cli/src/infra/player/playback-output-gate.ts`, and SSRF-hardened
  `apps/cli/src/infra/player/stream-gateway.ts`.
- **Why rework (A/V Cast only):** The branch predates W2 (`PlaybackPhase` split),
  VLC, and Stremio addons (`2026-09-01`). Port the core discovery + Cast V2 TLS
  client + subtitle gateway onto `PlayerService` and hardened gateway semantics;
  drop `--cast-audio` split-audio (Custom Web Receiver hosting + A/V clock sync
  overhead with low user payoff).

#### 3. Demo recording pipeline (`feat/demo-recording-pipeline`)

- **User value:** Maintainer pipeline (on branch: `tools/demo/*` — not on `main`)
  that stages an isolated Kunai profile (`assertProfileSafe` verifies
  `analytics: "unset"`, `installId: ""`, empty relay), captures 1440p Kitty +
  mpv takes on a dedicated Hyprland workspace, and encodes YouTube MP4, docs
  WebM, README 960px GIF, and vertical social cuts.
- **Fit & rework:** Self-contained and cheap to land (~1 day). Replace the
  branch's live-scraper hero scenes with controlled local-endpoint media so
  README/launch failover and addon clips never film third-party scraper streams.

#### 4. Website work (six branches / PRs)

- **`feat/workshop-link-previews-20261027` (closed #673):** All website files
  (`apps/docs/components/home/workshop-preview.tsx`,
  `apps/docs/components/layout/project-link-preview.tsx`, workshop images) are
  already identically on `main`. Drop the branch (its 4 unpushed local commits
  are unrelated QA/lint experiments; `b569a8674`'s Esc/Tab shell flash fix can
  be checked separately during Shell v4).
- **`wip/workshop-landing-and-tooling-20261122`:** A 468-file dirty backup
  snapshot (`backup/sumi-sakura-web-skin-20261122`). Its web skin lives cleanly
  in PR #760 and `scripts/sign-provider-manifest.ts` is already on `main`. Drop.
- **`docs/web-design-inspiration`:** Strict 3-commit ancestor of PR #760 with
  zero unique commits. Drop.
- **Open PR #760 (`docs/sumi-sakura-web-skin`):** Clean, fresh-base (2026-11-26)
  Sumi & Sakura landing/docs redesign with interactive command dock, Kitty split
  pane, install dock, and mobile/CodeRabbit fixes. Land in Phase 1 after
  refreshing homepage and `provider-directory` framing to lead with the
  addon-based client rather than promoting scrapers.
- **Open PR #716 (`feat/docs-seo-geo-indexing`):** Clean, high-leverage SEO/GEO
  upgrade (`/llms-full.txt`, `/llms.mdx`, RSS/Atom feeds, JSON-LD graph,
  IndexNow, `kunai-vs-ani-cli.mdx`, tests). Land first in Phase 1.
- **`docs/kanna-stay`:** Diverged 2026-10-03; adds ~2.5k LOC of isometric
  diagrams (`apps/docs/components/iso/` — not on `main`), Verlet pull-cord coat
  cycler, and Ask AI panel that conflict heavily with PR #760. Drop the branch;
  optionally cherry-pick the standalone `resolve-gate` isometric explainer in
  Phase 4.

#### 5. Relay fail-closed tests (`release/p1-relay-providers`)

- **User value / privacy gap:** When a user pins a metadata relay with
  `fallbackToDirect: false`, an unreachable relay must fail closed rather than
  falling through to direct `curl_chrome136` from the user's real IP.
- **Already on `main` vs. missing:** `packages/relay/src/create-relay-fetch-port.ts`
  on `main` handles header-based `isRelayLocalRefusal` and rethrows on
  unreachable relay, and `main` has newer DoH/pinned transports
  (`packages/relay/src/doh-transport.ts`, `pinned-transport.ts`). However,
  `main` lacks a typed `RelayRefusalError` (`RELAY_UNREACHABLE_CODE`) and lacks
  the `relay-unreachable` / `relay-refusal-adapters` regression suites (on
  branch: `packages/providers/test/relay-unreachable.test.ts`,
  `packages/relay/test/relay-unreachable.test.ts` — not on `main`), leaving
  adapters with `try { fetch } catch { curl }` fallbacks vulnerable to silent
  direct bypass.
- **Recommendation:** Rework — port only `RelayRefusalError`, adapter terminal
  rethrow guards, and the fail-closed test suites in Phase 0; drop the stale
  Oct 8 roster/doc commits (AniDB is already retired on `main`).

#### 6. Uncommitted work in three worktrees

- **`kitsunesnipe-main` (`docs/community-license-rfc`, 57 files):** Contains
  **four genuine fixes not on `main`** — (1) mpv `stderr: "pipe"` capture when
  `--mpv-debug` is enabled (`apps/cli/src/infra/player/PersistentMpvSession.ts`),
  (2) `mpvFileError` capture on `end-file` (`apps/cli/src/infra/player/mpv-stats.ts`),
  (3) `monotonicEnqueueIso()` FIFO fix in
  `apps/cli/src/services/download/DownloadService.ts`, and (4)
  `runQuarantineCanary` half-open recovery probe in
  `packages/core/src/provider-cycle-engine.ts` — **mixed together with
  untracked `webtorrent` + Real-Debrid magnet playback code** (`/torrent`
  command, `apps/cli/src/services/torrent/` and `apps/cli/src/services/debrid/`,
  not on `main`) and stale Oct-13 AllManga/Miruro/Videasy edits. (Its fifth
  fix — in-process serialization for the old `apps/cli/src/app-shell/search-history.ts`,
  which was removed on `main` — is already superseded by the stronger
  cross-process locked `apps/cli/src/services/persistence/search-history.ts`.)
  Salvage ONLY the four clean fixes in Phase 1; strictly drop all torrent/debrid
  code and stale scraper edits.
- **`release/distribution-and-signing` (T3 worktree, 24 modified + 4 untracked):**
  Every goal is already landed on `main` in a stronger form: `main`'s
  `apps/cli/src/services/persistence/credential-vault-backends.ts` already uses
  macOS `security -i` stdin and Windows `PasswordVault` round-trip probing, and
  `main`'s `scripts/packaging/release-supplements.ts`, `install.sh`,
  `.github/workflows/package-channels.yml`, and
  `apps/cli/test/integration/signed-installers.test.ts` already enforce
  **version-bound** Ed25519 manifest signatures (stronger than the worktree's
  raw-file signing). Drop.
- **`providers/health-pass` (T3 worktree, 17 modified):** Fully landed and
  superseded on `main` by #745 (YouTube `formatId` verification + Deno/yt-dlp in
  sweep) and #841/#845 (`providerDefaultsRevision: 8` in
  `packages/config/src/defaults.ts`). Applying it would regress defaults back to
  revision 7. Drop.

#### 7. Closed PR #636 (`feat/provider-toggles`) and PR #637 (`feat/youtube-resilience`)

Both closed branches appear to have ~26–30% unmatched added lines in a naive
line diff against `main`, **but 100% of their real user-facing behavior is
already on `main` (and improved)**:

- **PR #636 (`origin/feat/provider-toggles`, `39d195110`, stacked on
  `feat/ui-bootstrap-honesty` and `feat/movy-vidrock-recovery`):**
  - _Already on `main`:_ Manual provider switches (`disabledProviders`) in
    Settings (`apps/cli/src/app-shell/settings/registry/providers.ts`),
    `/providers` toggle checklist
    (`apps/cli/src/app-shell/workflows/shell-workflows.ts`), fail-closed
    exclusion across cache replay, inventory replay, and primary dispatch
    (`apps/cli/src/services/playback/PlaybackResolveService.ts` plus Stremio
    addon provenance admission), `sanitizeTerminalText` in
    `apps/cli/src/app-shell/loading-shell-runtime.ts`, accurate committed-title
    lane crumb in `apps/cli/src/app-shell/root-status-summary.ts`, parallel
    hedge copy (`describeProviderHedgeDetail`) in
    `apps/cli/src/app/playback/playback-stream-acquire.ts`, and Movy/VidRock
    recovery in `packages/providers/src/{movy,vidrock}/direct.ts`.
  - _Precisely what is "missing" (none of it matters):_
    1. Helpers that were refactored to cleaner homes on `main`
       (`isProviderEnabled` moved from `provider-priority.ts` to
       `apps/cli/src/domain/provider/provider-switches.ts`; default-revision
       tables moved from `ConfigServiceImpl.ts` to
       `apps/cli/src/services/persistence/provider-defaults-history.ts`; hedge
       UI moved from `PlaybackPhase.ts` to `playback-stream-acquire.ts`).
    2. Superseded provider defaults (revisions 4–5 vs. revision 8 on `main`) and
       pre-hotfix hardcoded Movy/VidRock constants (`main` wires both through
       the signed hotfix runtime).
    3. Obsolete throw-on-all-disabled-lane test assertion in
       `apps/cli/test/unit/services/providers/providers-disabled.test.ts` —
       `main` intentionally replaced the throw with an inert identity handle so
       disabling every provider in a lane cannot crash the shell render path.
    4. Stale generated docs snapshots (`generated-metadata.json`,
       `generated-provider-status.json`) and a changeset file.
- **PR #637 (`origin/feat/youtube-resilience`, `23493323c`, stacked on #636):**
  - _Already on `main`:_ **100% of its unique feature commit (`35fc508cd`) is
    verbatim on `main`** — `listYoutubeEpisodesViaYtdlp` playlist/channel
    `yt-dlp --flat-playlist` fallback in
    `packages/providers/src/youtube/direct.ts`, 90-day staleness check in
    `packages/providers/src/youtube/version-freshness.ts` + tests, and
    `describeStaleYtDlp` wiring in
    `apps/cli/src/services/youtube/youtube-diagnostics-probes.ts`.
  - _Precisely what is "missing" (none of it matters):_ Only the stacked PR #636
    delta above plus a 3-line dynamic-date fixture tweak (`23493323c`) in
    `apps/cli/test/unit/app-shell/panel-data.test.ts`.
- **Verdict:** **Drop both branches** — zero missing product value.
