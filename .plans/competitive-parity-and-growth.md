---
status: active
created: "2026-10-09"
---

# Competitive parity and growth

Study of what drives adoption among terminal media clients (widened 2026-10-09
to `pystardust/ani-cli`, `justchokingaround/jerry`, and `justchokingaround/lobster`)
and the gaps worth closing. Adjacent-medium
scope (manga reading) is tracked separately in
[manga-reader-lane.md](./manga-reader-lane.md). Peer-scan verdict:
Kunai already covers their flag surface (`--json`, `--download`, `--continue`,
`-S/-i/-t/-a`, Discord presence, doctor) — the residual borrow list is in
Remaining tracks (`--episode`/`--season`/`--quality` per-run flags, self-update
`-U`, community channels, status badges). This doc is the index — implement in
slices, archive rows as they land.

## What drives adoption in this category

1. **Mobile reach** — an Android/Termux install path is the single biggest
   download driver in this category; regional audiences respond to localized
   READMEs.
2. **Utility framing** — "find, download, and stream" leads; downloader is the
   pitch, not the shell.
3. **Breadth as content** — IPTV/M3U and addon ecosystems put a client in every
   GitHub topic, every "it plays X" conversation.
4. **Release cadence** — frequent releases signal liveliness in feeds.
5. **Every install channel** — cargo, Homebrew tap, Scoop, install scripts,
   Termux.
6. **Approachability** — mouse, `?` overlay, themes, personal-deck landing,
   pre-play resolution/subtitle pickers, one-key update modal, "zero telemetry".

## Already parity or better (verified 2026-10-09 — do not rebuild)

- Personal-deck landing: `buildBrowseIdleReturnLoopModel` in
  `apps/cli/src/app-shell/browse-idle-actions.ts` (continue, offline, queue,
  unwatched releases, calendar nudge). Missing piece: a saved/watchlist row.
- Batch/season download: `commitDownloadIntent` in
  `apps/cli/src/services/download/DownloadIntentService.ts` enqueues episode
  sets; `d` on the details sheet reaches it.
- Pre-play pickers: source/quality/audio/subtitle pickers exist
  (`app-shell/pickers/`, `openPlaybackStreamSelectionPicker`).
- In-shell update surface: `services/update/notification-update-action.ts` +
  `app-shell/root-overlay-shell.tsx`.
- Deeper than them everywhere else: resolve gate, provider health/hedging,
  Up Next crash-restore, autoskip, AniList/TMDB sync, diagnostics, presence.

## Landed in this branch (`feat/competitive-parity`)

### User-selectable themes

- `packages/design/src/themes.ts` — `ThemePalette` type derived from
  `TokenName`, `THEMES` registry, `listThemes()`, `isThemeName()`,
  `getThemeLabel()`. Adding a key to `tokens.ts` makes the compiler flag every
  palette that lacks it — drift is a type error, not a convention.
- `packages/design/src/palettes/*` — one file per palette. Shipped: `ember-dusk`
  (canonical brand, in `tokens.ts`), `kitsunebi`, `nord`, `tokyo-night`,
  `catppuccin-mocha`, `dracula`, `rose-pine`, `gruvbox`.
- `packages/design/src/index.ts` — `tokens` is now a live resolved box;
  `setDesignTheme(name)` re-resolves in place at the detected color level, so
  every render-time read repaints on the next frame. `KUNAI_THEME` handled at
  boot, not here.
- `apps/cli/src/app-shell/shell-theme.ts` — `palette` entries are getters over
  `tokens`; call sites unchanged.
- `@kunai/config` — `theme: string` (default `"ember-dusk"`). String not union:
  config may not depend on design (boundary allowlist); the theme registry is
  the validator.
- `apps/cli/src/container/bootstrap-persistence.ts` — applies
  `KUNAI_THEME` env, else `config.theme`, once config loads. Env is per-run,
  never persisted.
- `apps/cli/src/app/bootstrap/apply-settings-to-runtime.ts` — applies
  `setDesignTheme` when `theme` changes (live repaint on settings confirm).
- `apps/cli/src/app-shell/settings/registry/appearance.ts` — "Appearance"
  section + theme enum row sourced from `listThemes()`.
- `/theme` palette command — full seam walk: `AppCommandId`, `COMMANDS`,
  `commandGroupFor` (Core), availability, `COMMAND_CONTEXTS`
  (rootOverlay/activePlayback/postPlayback; excluded from modalPicker — a
  list-shell inside a modal picker could strand the open question),
  `SEARCH_BROWSE_COMMAND_IDS` (the browse palette's own list, not a context),
  `ShellAction`, `toShellAction`, `dispatchPaletteCommand`, and
  `openThemePicker` in `picker-workflows.ts` which persists through
  `persistSettingsDraft` (same write path as the settings row) and surfaces a
  set `KUNAI_THEME` instead of silently fighting it.
- `README.md` — `/theme` row, Themes feature line, and a "local-first,
  opt-in analytics" line in the pitch (the first-impression lesson: say it boldly
  where people read first, but keep it honest — off by default, not "zero").
- Theme live preview in settings: while the theme enum submenu is open,
  `SettingsShell` repaints on highlight (whole-shell preview, not a swatch);
  Esc restores the pre-preview theme via a ref (env-aware — a preview never
  leaks a config theme past `KUNAI_THEME`), Enter lands it through the normal
  persist, and unmount-mid-preview restores the same way.
- Saved/watchlist idle row: `buildBrowseIdleContext` now reads
  `container.listService.getWatchlist()` (read placed last in the try so a
  stubbed container only loses this row); `savedNext` on `BrowseIdleContext`;
  the `◈ <top watchlist title> · watchlist · N saved` row enters through
  `resolveIdleRowAction` → `watchlist`, which already routes through
  `PALETTE_WORKFLOW_ACTIONS` — zero new dispatch plumbing. Covers a
  resume + favorites landing with Kunai's vocabulary.
- Verified with `agent:drive`: `/theme` opens the 8-theme list with the
  active palette marked `· current`, a pick commits `"theme": "nord"` to
  `config.json` (`wait-config`), Settings → Appearance → Theme commits
  `"theme": "kitsunebi"`, and `KUNAI_THEME=dracula` marks Dracula and shows
  the override note. Golden captures cover both the Appearance tab and the
  new saved row.

Hit-every-seam walk: config key→reader (apply + boot), reverse state (pick any
theme back), entry points (settings row, `/theme` palette, `config.json`,
`KUNAI_THEME`), platforms (curated fallbacks for the brand palette,
mechanical xterm-256/ANSI-16 quantize for themed palettes), docs
(`design-system.md`, `customization.mdx`, generated command table).

### Per-lane quality settings

- Settings › Language now exposes a quality row for every lane, not just
  YouTube: `animeLanguageProfile.quality`, `seriesLanguageProfile.quality`,
  and `movieLanguageProfile.quality` were live config keys consumed by
  `playbackQualityPreference()` at resolve time but had no UI — you could
  only set them by editing `config.json`. Rows share
  `PROVIDER_QUALITY_SETTINGS_OPTIONS` (extracted to
  `settings/registry/shared.ts`); YouTube keeps its own yt-dlp-specific list.

### Confirm before play (`prePlayConfirm`)

- `prePlayConfirm: "off" | "when-choices" | "always"` in `@kunai/config`
  (default `off`), normalized in `ConfigServiceImpl`, metadata in
  `config-metadata.ts`, settings row in `settings/registry/playback.ts`
  (`PRE_PLAY_CONFIRM_SETTINGS_OPTIONS` in shared).
- Policy: `shouldOfferPrePlayConfirm()` in `app/playback/source-quality.ts` —
  `off` never, `always` when inventory exists, `when-choices` only when
  `sourceCount > 1` or a quality/track control exists. Bare direct streams
  never prompt.
- Integration in `PlaybackPhase.ts`: `prePlayConfirmOffered` gates one offer
  per launched session (autoplay/retry do not re-ask), opens the existing
  `openTracksPanel` sheet pre-mpv, routes picks through the existing
  `streamSelectionFromTrackPick` + `completeSourceTrackPick` restart path,
  Esc falls through to the resolved default. No new picker — a confirm-screen
  flow on Kunai's machinery.
- Docs: `media-selection.mdx` "Confirm before play" section,
  `customization.mdx` playback table row, README Playback feature line.
- Unit tests cover all three modes + no-inventory/direct-stream cases in
  `test/unit/app/source-quality.test.ts`.

### Download live stats

- yt-dlp progress lines carry `of ~SIZE at SPEED ETA tail` fields that were
  being dropped — only the `%` was parsed. New pure parser
  `services/download/ytdlp-progress.ts` extracts size/speed/ETA; the
  `progress` `DownloadEvent` carries them as transient fields (never
  persisted — no schema migration).
- `download-manager-shell.tsx` keeps a `liveStats` map (set on progress,
  cleared on terminal events): the queue row secondary shows speed when
  known (else the existing estimated ETA), and the preview rail gains
  Speed/ETA rows plus "N% of SIZE" in the Progress fact via
  `buildDownloadManagerRailModel`'s new optional `live` arg.
- README downloads list line added.

### Comparison and feedback surfaces

- README "Coming from" table gains a `Streams` row (the real differentiator:
  probed before mpv sees them vs as found).
- README Contributing gains a feature-request pointer: `feature_request.yml`
  template + Discussions + the existing `/feedback` docs page (the feedback
  page and issue templates already existed — the README just never linked
  them).

### First-launch conversion (the first-impression lesson)

- Content-first landing: a never-onboarded install
  (`isBelowOnboardedFloor`, captured before the wizard runs) with no explicit
  route/query/offline intent now opens `initialRoute: "recommendation"` in
  `main.ts` — first screen is something to watch, not a bare search form.
- Empty-deck discovery row: when `buildBrowseIdleReturnLoopModel` resolves
  with zero rows and the idle context status is `"ready"`, the deck shows
  `✧ Trending this week · see what's popular` routing to the existing
  discovery feed (`resolveIdleRowAction` handles `"trending"` before the
  null-context early return). Verified on a fresh-seed drive.
- Setup wizard 7 → 6 screens: the standalone Playback screen folded into
  "Playback, downloads & accounts" (`library` screen, rows 2–4) — its own
  copy admitted the toggles were easy to change later. `s` on that screen now
  applies both the playback recommendations and the download-quality reset;
  `S` folds the playback defaults under `library`. Deps, Mode, Language, and
  the consent screen stay — dependencies are the one hard gate, mode/language
  are real decisions, and consent must be an explicit keystroke. The
  denser-than-2-screens option (mode+language+consent in one screen) was
  rejected: it buries decisions that shape the whole app.
- Golden captures renumbered (`setup-4-library`, `setup-5-analytics`,
  `setup-6-done`); tmux onboarding proof updated and green.

### Per-run playback flags (ani-cli/jerry parity)

- `-e/--episode <n>` + `--season <n>` (series only), `--quality`,
  `--audio`, `--sub`, `--dub` — validated against the shared
  `domain/media-preferences` catalogs, usage errors on bad values
  (`--season` without `--episode` included: silently guessing S2E1 is the
  house failure mode).
- Episode rides a one-shot `state.episodeRequest` (raw numbers, cleared by
  `SELECT_TITLE`) rather than a synthetic `EpisodeInfo`: it feeds the
  `flags`/`preselectedEpisode` the episode-entry resolvers were already
  built for — the `flags: {}` stubs at both `chooseStartingEpisode` call
  sites were the never-wired half of this feature. Playback (`-S`, `-i`,
  `--continue` conflict resolved flag-wins) and `--download` (skips the
  episode checklist) both consume it.
- `--quality`/`--audio`/`--sub` are `applySessionOverrides` on the three
  provider lane profiles — memory-only, config.json untouched (verified:
  launched with `--quality 720p --dub`, config still reads `best`/`original`).
  YouTube excluded — its quality vocabulary is yt-dlp-shaped.
- tmux-verified on real `main.ts`: `-S "smoke series" --jump 1 -e 2` spawned
  mpv with `series-s1e2.mp4` and post-play reported "resume S01E02".
- Vocabulary moved, not duplicated: `PROVIDER_QUALITY_PREFERENCE_OPTIONS`
  now lives in `domain/media/media-preferences.ts` beside the audio/subtitle
  catalogs; `settings/registry/shared.ts` re-exports it.

## Remaining tracks

### Shell and UI

| Track                           | Layer(s)                                                                 | Notes                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live preview in `/theme` picker | `openListShell` highlight hook                                           | The settings submenu previews on highlight; the palette picker applies on confirm only. Needs an `onHighlight` on `openListShell` — touches every picker caller, so keep it behind an options flag. |
| Mouse support                   | `app-shell` input layer only                                             | The SGR mouse foundation already exists in open PRs #521 (`feat/mouse-input-foundation`) and #545 (legacy X10/urxvt strip); needs re-implementation on main plus hit-region coverage (#552).        |
| Live-TV / IPTV mode             | `packages/providers/src/m3u` + storage playlists + settings + TV surface | Streams are direct URLs → fits provider model with no resolve; still probed by `verifyCandidateStream`. EPG/categories are the real work. Scope: a `.plans/` entry of its own before code.          |
| VLC/IINA launch-only            | `infra/player`                                                           | Degraded mode (no IPC ⇒ no autoskip/resume/presence). Record capability split if done; default remains mpv.                                                                                         |

### Distribution and growth (repo plumbing, not runtime)

| Track                                         | Where                                   | Notes                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homebrew tap + AUR `kunai-bin` + Scoop bucket | `Formula/`, `bucket/`, release workflow | Release pipeline already emits signed archives + attestations; this is publish plumbing on top. Needs repo-owner secrets/dispatch.                                                                                                                                                                             |
| Localized READMEs                             | `README_{ES,HI,PT-BR,JA,BN}.md`         | One file each, linked from the README header. Translations need a native pass, not just machine output.                                                                                                                                                                                                        |
| Community surface                             | README links                            | Discord or Telegram; where star→user→evangelist loop lives.                                                                                                                                                                                                                                                    |
| Topics + comparison                           | repo settings                           | Add `downloader`, `tv-shows`, `movies` topics (`gh repo edit`).                                                                                                                                                                                                                                                |
| ~~CLI parity flags~~ → landed                 | `cli-args.ts` + play intent             | `-e/--episode` + `--season` + `--quality` + `--audio` + `--sub` + `--dub` shipped (see "Per-run playback flags" above). `-q` stayed `--quick` — the long flag avoids the collision entirely.                                                                                                                   |
| Self-update                                   | release pipeline + `kunai doctor`       | All three peers ship `-U`. The in-shell update surface exists (`notification-update-action`) — closing the loop means a real "apply update" path per install channel (npm vs binary), not another notification.                                                                                                |
| Provider contribution path                    | `docs/developer/` + provider template   | Bounded pluggability (decided 2026-10-09): no arbitrary runtime JS — providers run in-process with config/history/tokens in reach and the contract is unstable TS. The honest 80% is a declarative custom-source/M3U adapter + provider scaffolding docs/template so community providers land as reviewed PRs. |
| Status surface                                | README badges + `kunai doctor`          | ani-cli's uptime badges prove users check "is it me or the provider". `kunai doctor` + provider-health notices exist; a README status/uptime badge needs a real monitored endpoint to point at — do not fake it.                                                                                               |
| Termux/Android                                | `apps/mobile`                           | Mobile-terminal demand is the category's biggest download driver; Bun can't ship bionic binaries so the mobile Termux composition is the answer — prioritize its qualification track.                                                                                                                          |
| Release cadence signal                        | `RELEASING.md`                          | Smaller, more frequent cuts; the staged pipeline supports it.                                                                                                                                                                                                                                                  |

## Explicit non-goals

- Stremio addons — invites unverifiable gray-area streams, conflicts with the
  resolve gate.
- "Zero telemetry" copy — ours is opt-in; the honest line is "off by default".
- Chasing the name — `kunai` builds its own search demand via the moat
  (correctness + persistence), not by scraping someone else's brand traffic.
