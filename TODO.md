# TODO

## Immediate bugs / fixes

- [ ] **Settings pre-search gate** — `[c]` typed at the search prompt goes into the text box instead of opening settings. Fix: show raw-mode key menu BEFORE calling `text()`. Keys: `/` = search, `c` = settings, `a` = toggle anime mode, `q` = quit. See `.plans/roadmap.md`.

- [ ] **MPV video reopening bug** — after MPV exits naturally, relaunching the same episode sometimes silently fails. Suspected cause: cached wixmp token expired (AllAnime tokens ~20 min, cache TTL 1 hour). Add logging around cache hits + stream validation before relaunch.

- [ ] **CinebyAnime needsClick** — `embedScraper` callback in `index.ts` hardcodes `needsClick: false`, but `cineby.sc/anime` URLs need a click. Detect anime embed URLs and pass `needsClick: true`.

## Near-term improvements

- [ ] **fzf npm package** — replace fzf binary dependency with `fzf` npm (pure TypeScript). Prerequisite for Ink migration. Package: https://www.npmjs.com/package/fzf

- [ ] **npm publish setup** — verify `apps/cli/src/main.ts` builds to `dist/kunai.js` and the `kunai` bin field points at that artifact. (Task #1 in task list.)

- [ ] **Tests for pure functions** — `formatTimestamp`, `isFinished`, `buildUrl`, cache TTL logic, search result mapping. (Task #5 in task list.)

## Planned (needs spec / discussion)

- [ ] **Ink migration** — full terminal UI rewrite. See `.plans/ink-migration.md`. Prerequisite: fzf npm package.

- [ ] **SQLite migration** — replace `history.json` + `stream_cache.json` + in-memory TMDB cache with `bun:sqlite`. Enables proper TTL tracking per token, not just per URL. Deferred until Ink migration is done.

- [ ] **YouTube provider** — `yt-dlp` + Invidious search. Deferred — read ytfzf source first. See `.plans/yt-provider.md`.

- [ ] **Search service deep refactor** — promote HiAnime to standalone `SearchService`, decouple from CinebyAnime provider. See `.plans/search-service.md`.

- [ ] **Provider hardening** — dossier-first research flow, multi-source inventory, subtitle/quality/dub modeling, and stronger diagnostics. See `.plans/provider-hardening.md`.

## Housekeeping

- [ ] License file + CI workflow (Task #6)
- [ ] Git hooks (Task #4)
- [ ] Config files: biome, oxlint, commitlint (Task #3)
