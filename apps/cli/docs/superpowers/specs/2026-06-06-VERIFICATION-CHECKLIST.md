# Verification Checklist — 2026-06-06 session

Run `bun run dev` (wide terminal for posters). Tick each. ✅ = automated-test-covered already; 👁 = needs your eyes/TTY.

## Tracks / Servers

- [ ] 👁 During playback, `s` (or `/source`) opens the **nested two-pane** panel; `↑↓` sections, `→` enter, `↑↓` options, `⏎` switches and plays the right stream; `←`/`esc` backs out keeping place.
- [ ] 👁 `f` on a server toggles ♥, pins it to top, **persists** (reopen → still ♥; `~/.config/kunai/config.json` has `favoriteSources`).
- [ ] 👁 With a favorite set, a fresh episode **auto-selects** the favorited server when available.
- [ ] 👁 Subtitles render as a **grid**; footer shows nav hints (not "facts only") even when nothing is switchable.
- [ ] ✅ `n`/`p`/`s`/`r`/`e`/`q`/`k` unchanged (registry audited).

## Classification & History (#1, #4, #6)

- [ ] 👁 Stats → **Anime** tab: dramas (Perfect Crown, Wonderland, Absolute Value of Romance) now under **Series**, not Anime. (Backfill runs once on launch; re-watch fixes any real-anime lacking AniList/MAL id.)
- [ ] 👁 `/history` → **Shift+Tab** cycles Anime/Series/Movies; plain Tab cycles Continue/Completed/New/All.
- [ ] 👁 History rows show **poster art** in the rail (new watches store it; old rows fill in as re-watched).
- [ ] 👁 **Resumed playback shows a poster** (was missing — history now persists/restores the poster URL).

## Calendar (#2)

- [ ] 👁 `/calendar` day chips are **chronological** (no "SAT 6 · MON 8 · SAT 5").
- [ ] 👁 No status text overflow/overlap into the next row (status column now truncates).

## Search / Browse (#3)

- [ ] 👁 A small search (e.g. "Jujutsu", ~6 results) shows **no** redundant "Filter results" box; a big browse list (≥12) still does.

## Pickers

- [ ] 👁 Episode picker for a **single-season** series: pressing `esc` **exits** (no more infinite stuck loop). Multi-season still backs to the season list.
- [ ] 👁 "Where to start?" picker shows the **title poster** in the rail (#7).

## Autoplay / Performance (the big ones)

- [ ] 👁 **Next-episode autoplay is snappy** — the long pause should be gone (prefetch was being voided by a `startupPriority` `undefined` vs `"balanced"` mismatch; now normalized).
- [ ] 👁 A stream that **fails to start** no longer flips autoplay to "paused".
- [ ] 👁 AllManga **older-show posters** now load (was 404 — wrong CDN host; now `wp.youtube-anime.com/aln.youtube-anime.com`).
- [ ] 👁 Quick check: time `~/Projects/osc/ani-cli` vs Kunai on one anime title — if ani-cli is also slow, remaining slowness is **upstream AllAnime**, not us.

## Up Next — Continuous Play (LOOP SHIPPED)

- [ ] ✅ `autoplayRecommendations` defaults on; `resolveNextUp()` pure decision unit-tested.
- [ ] 👁 Finish a series with nothing queued → **"Up next: <rec> in 5s · a to pause"** → plays the recommendation; `a` cancels, stays in post-play. (YouTube-style auto-continue.)
- [ ] 👁 Post-play `1`/`2`/`3` plays that rec **now**; `!`/`@`/`#` opens its action panel (add-to-queue / details / download).
- [ ] 👁 Browse/search `q` on a row → "Queued <title>" → it **auto-plays after the current finishes** (cross-title advance).
- [ ] 👁 During playback, the **"up next"** line shows the **queued title** when there's no next episode.
- [ ] 👁 **`/queue`** opens the Up Next panel — see the queue (▶ next-up, ✓ played), **Play now** a queued item, clear, **save queue as playlist**, import/export, refill from watchlist.
- [ ] 👁 **AllManga**: a hung Ak endpoint now fails fast (~4s) to the next provider instead of stalling ~12s.
- [ ] 👁 **`/audio`** / **`/subtitles`** open the tracks panel **at that section**; `/streams` is gone; `/source` also answers to `/tracks` `/servers`; the in-player `t` + post-play tracks footer still open the panel (at source).

## Genuinely remaining (deferred — risky/ambiguous to do blind)
- **Small rec-card posters** — 3 Kitty images per post-play is the same multi-image path as the **#8/#13 ghosts you reported**; doing it blind risks worsening that bug. Pair it with the ghost fix, on your TTY.
- **Episode titles/thumbnails in the picker** — data lives in the per-episode *source-resolve* blob, not the catalog; it's a resolve→picker pipeline change.
- **#5 series-%** — a true series % needs a reliable total-episode count (genuinely ambiguous across seasons/anime); current % is per-episode. Left as-is rather than show a wrong denominator.
- **Download-all-in-queue** — needs per-item resolve + `DownloadService` job orchestration (a real feature, not a quick add).

## Installer / README

- [ ] 👁 `KUNAI_DRY_RUN=1 ./install.sh` checks for Bun; README leads with the Bun prerequisite.

---

## Branch state (all gate-green: typecheck · lint · tests · build)

- **`main`** — 33 commits unpushed: tracks favorites+auto-select, #1–#4, #6/#7 posters, autoplay/escape/spill/footer fixes, **prefetch perf fix**, installer.
- **`fix/allmanga-thumbnails-and-perf`** — 2 ahead: AllManga thumbnail host fix + fixture.
- **`feat/up-next-continuous-play`** — Up Next spec + 8-task plan + Tasks 1–2 (config + resolver).

## Still open (after this session)

- Up Next Tasks 3–8 (playback-core wiring — live-verify).
- AllManga perf next steps (agent report): surface `episodeInfo.notes`/`thumbnails[]` (episode titles + per-episode previews, already in the decrypted blob); cap Ak lane timeout to 4s + baseline fallback; cache `episodeInfo`. Keep the wide search query (we _want_ the popularity/AniList/MAL metadata it returns).
- #5 series-% (needs reliable episode-count denominator).
- Poster-ghosts #8/#13 (TTY-only Kitty failed-image regions).
- Task 10 (`/streams` command cleanup) — coordinate with the `/queue` remap.
