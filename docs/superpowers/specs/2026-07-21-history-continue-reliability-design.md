# Design — History, Continue, Playback Reliability & Search Filters

Date: 2026-07-21  
Status: locked (brainstorm), pending implementation  
Approach: **1 — shared policy module + thin UI** (both tracks)  
Scope: **Track A** (slices 1–7) + **Track B** (search filter repair, slices B1–B5)

This master design hardens continue-watching ranking, soft-fallback provider hops, history stamp rules, history delete UX, provider recovery surfaces, episode-picker parity, shortcut chrome, post-play poster rails, **and** the broken search/browse filter wiring. It does not change provider scrape contracts, relay policy, or offline download semantics.

Related priors:

- [History & Continuation Read Model](./2026-05-28-history-continuation-read-model-design.md) — per-episode `HistoryProgress` truth and Continue anchor rule
- [.plans/binge-playback-handoff-provider-health.md](../../.plans/binge-playback-handoff-provider-health.md) — session-soft fallback vs durable title preference
- [.plans/search-filter-state.md](../../.plans/search-filter-state.md) — P6 marked “implemented” but browse wiring is incomplete (this Track B repairs it)

---

## Package shape

| Track                                  | Focus                                                                                               | When                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **A — Continue / history reliability** | Progress gates, soft-fallback preference, recovery, history delete, episode picker, chrome, posters | First                                                                                                                |
| **B — Search filter UX repair**        | Parser vocabulary, `/filters` vs Ctrl+F, apply honesty, sticky chips                                | After Track A chrome (slice 6) so focus/overlay assumptions are stable; may start after A3 if parallelized carefully |

Two implementation plans may be produced from this spec (one per track). Same Approach 1: shared domain policy + thin UI.

---

## 1. Goals & non-goals

### Goals (Track A)

1. **One policy for engage/resume gates.** Continue ranking, resume persistence, last-watched bumps, and title-preference promotion share the same dual trusted-progress thresholds so search-launched and continue-launched playback cannot diverge.
2. **Soft fallback without silent preference mutation.** Automatic provider hops remain allowed for the active session; durable `titleProviderPreferences` promote only after real engage on the fallback winner.
3. **History stamps match what actually played.** Finalize and mid-play checkpoints write `resolvedProviderId` when a soft hop is active, so resume/Continue/launch do not re-anchor on a dead primary.
4. **Did-not-start stays invisible to Continue.** Stuck ~0 progress with known duration must not poison `last_watched_at` or Continue ranking.
5. **Recoverability without hotkey sprawl.** Provider health reset and cache clear are discoverable via browse palette, Settings Storage, and title menu — not `F` / `Shift+F`.
6. **History delete is immediate and scoped.** Episode row delete vs whole-title delete with confirm; multi-select deferred.
7. **Episode picker parity.** Mid-playback and search/TMDB pickers pass the same anime episode list (and preview body when available) so anime mode does not fall back to naked numbered stubs.
8. **Shortcut chrome matches the registry.** Legend glyphs use `⇧` / `⌃`; letter case follows the binding registry, not ad-hoc `toLowerCase()` in footers.
9. **Recs/posters ride last.** Recommendation rails and `MiniPosterTile` polish land after reliability and chrome.

### Goals (Track B)

1. **Tokens that are advertised must parse and apply (or correct clearly).** No silent ignore of `type:anime`, `mode:youtube`, etc.
2. **`/filters` opens guided facets; Ctrl+F only narrows loaded results.** Distinct commands, distinct UX.
3. **Evidence honesty.** Badges match upstream / local / unsupported apply paths; library filters are real or unavailable — not theater.
4. **One `FilterState` owned by domain**, mutated by tokens and the facet sheet; query bar shows chips + plain text.
5. **Bootstrap / `-S` uses the same intent pipeline** as browse Enter (no string-only drop of filters).

### Non-goals

- Multi-select history delete, bulk library wipe UX redesign, or remote-synced watch state.
- Changing global default-provider selection, health scoring weights, or binge prompt thresholds from the prior binge/handoff plan (except the engage-gated preference promote rule below).
- New provider adapters, relay video fallback, or Playwright/browser runtime revival.
- Replacing Continue reconciliation engines again (read-model from 2026-05-28 stays).
- Redesigning the full help overlay or remapping the entire keybinding surface.
- Autoplays that skip the dual gates or invent a third “almost engaged” band.
- New recommendation algorithms (Track A slice 7 is presentation/reliability only).
- Full discover/trending filter sticky redesign beyond “honor or explicitly ignore with labeled UI.”

---

## 2. Architecture (Track A)

### Approach 1 — shared policy module + thin UI

All gate and soft-fallback decisions live in one shared policy module under the CLI domain/services boundary. Call sites become thin adapters: they pass playback evidence in, apply the returned decision, and do not re-encode thresholds.

```text
mpv trusted progress / PlaybackResult
        │
        ▼
┌───────────────────────────┐
│  ProgressEngagePolicy     │  resume gate · engage gate · stuck/DNS
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│ SoftFallbackPreferencePolicy │ session soft hop · promote · forget
└───────────┬───────────────┘
            │
    ┌───────┴────────┬──────────────────┐
    ▼                ▼                  ▼
 history write   Continue/idle      preference I/O
 ledger/finalize ranking            playback-provider-switch
```

### 2.1 `ProgressEngagePolicy`

Pure functions over trusted progress evidence (`lastTrustedProgressSeconds`, duration, suspected dead stream, end reason). Locked dual gates:

| Gate               | Threshold                  | Effects when crossed                                                                                               |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Persist resume** | trusted progress **> 10s** | Allow history upsert / ledger finalize to keep resume position; eligible for resume-point classification           |
| **Engage**         | trusted progress **> 30s** | Continue ranking eligibility; bump `last_watched_at`; promote soft-fallback winner into `titleProviderPreferences` |

Additional locked rules:

- **Stuck / did-not-start:** trusted (or effective) progress ≈ 0 **and** `durationSeconds > 0` classifies as did-not-start. Do **not** update `last_watched_at`. Do **not** treat as engage. Do **not** promote preferences. Existing resume rows for that episode remain untouched unless an explicit user mark-watched path runs.
- **Completion / EOF overrides:** existing completion-threshold and clean-EOF persistence paths in `shouldPersistHistory` / `toHistoryTimestamp` remain; they may persist completion without requiring the 30s engage gate, but they still must not stamp a soft-hop as a durable preference without engage.
- **Browse idle Continue filter:** `buildBrowseIdleContext` today requires `positionSeconds > 30` and unfinished. That 30s bar becomes the **engage gate** from this policy (trusted progress when available; otherwise the persisted position already written under the resume gate). No third magic number.

Current drift to collapse:

- `apps/cli/src/domain/playback/playback-history.ts` — `shouldPersistHistory` uses `> 10` on watched/trusted (resume-adjacent).
- `apps/cli/src/domain/playback/playback-progress-policy.ts` — resume point uses `<= 10` cutoff.
- `apps/cli/src/app-shell/browse-idle-context.ts` — Continue row uses `positionSeconds > 30`.

These must import the shared constants/predicates instead of literals.

### 2.2 `SoftFallbackPreferencePolicy`

Owns session vs durable provider preference for a title:

| Layer                        | Storage                                                                    | When set                                                       | Cleared by                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Session soft hop**         | `playback-run-state.sessionSoftProviderId`                                 | Auto-fallback resolve succeeds for this run                    | Explicit `/provider` switch, user switch seq bump, run end, align helpers                                       |
| **Durable title preference** | `KitsuneConfig.titleProviderPreferences` via `playback-provider-switch.ts` | Soft-hop (or other non-preferred) winner after **engage** gate | Title menu “forget preference for this title”; user explicit switch to another provider (existing persist path) |

Locked behavior:

- Soft fallback **allowed** during resolve (existing `PlaybackPhase` / `PlaybackResolveService` path).
- On soft hop: set `sessionSoftProviderId = resolvedProviderId`; show session note (existing copy pattern). Crumb may show `AllManga→Miruro` when selected ≠ stream (`root-status-summary.ts`).
- **Do not** call `persistTitleProviderPreference` at hop time.
- **Promote** soft-fallback winner to durable title preference **only after engage** (`trusted > 30s`) on that resolved provider for the title/episode session.
- If preferred provider fails and soft hop plays but engage never happens (DNS / quit early): leave durable preference unchanged; session soft may still guide the rest of the run.
- Explicit user provider switch remains durable immediately (existing `applyUserProviderSwitch` / persist path) — that is user intent, not soft fallback.

**Naming note:** display name `AllManga` vs provider id `allanime` is the same provider — not a second hop. Up Next `MR` initials mean “My Roommate…”, not Miruro.

### 2.3 Thin UI / shell adapters

UI and shell layers must not encode thresholds:

- History overlay / browse idle only consume ranked rows produced under engage rules.
- Title-control and Settings only invoke command IDs / preference clear helpers.
- Footers/legends only format chords from the registry.

---

## 3. Data flow (Track A)

### 3.1 Continue vs search launch (parity)

Both paths must apply the same preference and soft-hop rules.

```text
Continue / history resume          Search / discover / share pick
        │                                    │
        ▼                                    ▼
 launch-entry.ts                      SearchPhase / share resolve
 applyTitleProviderPreferenceToSession
        │                                    │
        └────────────┬───────────────────────┘
                     ▼
              PlaybackPhase
         resolve (soft fallback OK)
                     │
         sessionSoftProviderId if hop
                     │
              mpv + ledger checkpoints
                     │
         ProgressEngagePolicy on evidence
                     │
         ┌───────────┼────────────┐
         ▼           ▼            ▼
   persist resume  engage     preference promote
   (>10s)          (>30s)     (soft winner only)
```

Parity checklist:

- Soft fallback allowed on both continue and search launches.
- Preference promote only after engage on both.
- Recovery commands (`/reset-provider-health`, `/clear-cache`, forget preference) available from browse palette / Settings / title menu regardless of launch path.
- History finalize stamps `resolvedProviderId` on both paths.

### 3.2 Soft hop stamp rules

When soft hop is active (`sessionSoftProviderId` set, or `resolvedProviderId !== configured primary`):

1. **Ledger start / checkpoint / finalize** must carry `providerId: resolvedProviderId` (align `PlaybackHistoryLedger` context when hop becomes active — do not leave checkpoints on the failed primary).
2. **`historyRepository.upsertProgress` / finalize** in `PlaybackPhase` already passes `resolvedProviderId`; keep that as the authority and ensure mid-play checkpoint registration uses the same id after a hop.
3. **Launch re-entry** (`launch-entry.ts` history provider lane / entry `providerId`) then resumes against the provider that actually played after engage-persisted rows.

### 3.3 Did-not-start / stuck progress

Classifier (policy): ~0 trusted progress **and** duration known (`durationSeconds > 0`), optionally with `suspectedDeadStream` / post-play `did-not-start` kind.

Effects:

- Post-play may still show did-not-start recovery UI (`post-play-state.ts`, `run-post-playback-menu.ts`).
- **No** `last_watched_at` bump.
- **No** Continue re-rank to top for that attempt.
- **No** preference promote.
- Resume persistence: do not overwrite a good prior resume with a zero/stuck stamp; if no prior row, do not create a Continue-eligible row.

### 3.4 Continue ranking & last-watched

Engage gate is the only path that:

- Bumps `last_watched_at` for ranking / “last watched” surfaces.
- Lets an unfinished row become the browse idle Continue hero (`browse-idle-context.ts`).
- Promotes soft-fallback preference.

Resume gate alone may keep a mid-episode position for later resume without making the title the Continue hero or rewriting durable preference.

---

## 4. History delete UX

### Locked NOW

| Chord     | Scope                                                  | Confirm                    |
| --------- | ------------------------------------------------------ | -------------------------- |
| `x`       | Delete **episode row** (selected history progress key) | `y` confirm / `Esc` cancel |
| `Shift+X` | Delete **whole title** (`deleteTitle(titleId)`)        | `y` confirm / `Esc` cancel |

Repository APIs already exist:

- `packages/storage/src/repositories/history.ts` — `deleteProgressByKey(key)`, `deleteTitle(titleId)`

Wiring surfaces:

- `apps/cli/src/app-shell/history-shell.tsx` — status / confirm chrome
- `apps/cli/src/app-shell/use-history-overlay-input.ts` — key handling (add `x` / `Shift+X` / confirm)
- `apps/cli/src/app-shell/keybindings.ts` — registry entries + legend (glyphs per §7)
- Footer / help copy must show `x` and `⇧X` consistently

After delete: redraw history projection; if idle Continue pointed at deleted title/episode, rebuild `browse-idle-context`.

### LATER (explicit non-goal for this package)

- Multi-select delete
- Undo stack
- Soft-delete / trash

---

## 5. Provider recovery UX

### Surfaces (locked)

1. **Browse command palette** — `/reset-provider-health` and `/clear-cache` must appear in browse/search command lists:
   - Add IDs to `apps/cli/src/app-shell/search-browse-command-ids.ts`
   - Already defined in `apps/cli/src/domain/session/command-registry.ts`
   - Handlers already in `apps/cli/src/app-shell/workflows/shell-workflows.ts`
2. **Settings → Storage** — `apps/cli/src/app-shell/settings/registry/storage.ts` gains a **Reset provider health** action beside clear-cache / clear-history (Danger Zone).
3. **Title menu** — `apps/cli/src/app-shell/title-control/title-control-actions.ts`:
   - Keep existing `reset-provider-health` / `clear-cache` actions.
   - Add **“Forget preference for this title”** — clears `titleProviderPreferences` for the canonical title id via `playback-provider-switch` helpers (new clear helper next to `persistTitleProviderPreference`).

### Explicitly forbidden

- **No `F` / `Shift+F`** bindings for health reset (do not add hotkeys that collide with other scopes or expand muscle-memory surface).
- Recovery remains command / settings / title-menu driven.

### Why cache clear left users on Miruro

Stream-only `/clear-cache` does **not** clear `provider_health`, `title_provider_health`, or `titleProviderPreferences`. Continue still restores history/`preference` provider → soft hop to Miruro can persist as the sticky path. Recovery surfaces above fix discoverability; engage-gated promote + forget preference fix the durable pin.

### Copy intent

Calm, local: forget failure memory; clear stream cache; forget per-title provider pin. Do not imply a cloud account reset.

---

## 6. Episode picker parity

### Problem

`buildPlaybackEpisodePickerOptions` (`apps/cli/src/app/playback/playback-episode-picker.ts`) already accepts `animeEpisodes` and prefers that list in anime mode. Mid-playback opener `openActivePlaybackEpisodePicker` in `apps/cli/src/app-shell/ink-shell.tsx` builds options **without** passing `animeEpisodes`, so anime falls through to numbered stubs from `animeEpisodeCount`.

TMDB path (`tmdb-season-episode-pickers.ts`) sets `previewBody` (synopsis); playback builder often omits it → “no preview art” / empty rail on one path and filled content on the other.

### Locked fix

- Thread the active run’s `currentAnimeEpisodes` (or equivalent session cache) into `openActivePlaybackEpisodePicker` → `buildPlaybackEpisodePickerOptions({ animeEpisodes })`.
- Share `previewBody` / still URLs when available (align playback builder with TMDB helper patterns).
- Keep TMDB season hop behavior for non-anime; anime continues season-1 absolute indexing.
- If `animeEpisodes` is empty, retain today’s count-based fallback (no fake titles).

Acceptance: mid-play episode picker in anime mode shows the same labels/details/preview body as the pre-play anime picker for the same title when data exists.

---

## 7. Shortcut chrome + input focus

### Legend style (locked)

- Modifier glyphs: **`⇧`** for Shift, **`⌃`** for Ctrl (replace prose `Shift` / `Ctrl` in legend/footer formatting where chords are shown).
- **Letter case from registry** — if the binding registry stores `x` vs `X`, display that case; stop blanket `formatChord(...).toLowerCase()` in footer helpers that erase registry intent.
- Touch points:
  - `formatChord` / `footerKeyFromBinding` in `apps/cli/src/app-shell/keybindings.ts`
  - Callers that force `.toLowerCase()` on formatted chords (`loading-shell-model.ts`, `title-control-post-play.ts`, `post-play-view.ts`, `playback-session-key-hints.ts`, etc.) must use the shared formatter instead of local lowercasing.

### Browse input focus

`browse-shell.tsx` already special-cases Tab / idle Continue focus while the search line is active. This slice:

- Keeps Tab cycling calendar type tabs when calendar is focused.
- Ensures history delete confirm (`y` / `Esc`) does not leak into the search line editor while the history overlay owns focus.
- Suppresses letter hotkeys (`e`, etc.) while text input / command palette owns focus (align with `.docs/ux-architecture.md`: text wins except Ctrl+C, `/`, Esc).
- Does not invent new focus modes beyond fixing confirm, text-input ownership, and legend consistency.

---

## 8. Recs / posters

Last Track A slice. Depends on engage/Continue correctness so recommendation rails do not promote titles from poisoned last-watched stamps.

Touch points:

- `apps/cli/src/app-shell/post-play-shell.tsx` — `MiniPosterTile` rails
- `apps/cli/src/app-shell/primitives/MiniPosterTile.tsx`
- Existing poster pipeline (offline artwork cache / chafa-kitty path per `.docs/poster-image-rendering.md`)
- Post-play recommendation assembly (`apps/cli/src/app/post-play/post-playback-recommendations.ts`)

Scope for this package:

- Ensure post-play mini posters render when URLs exist; degrade cleanly when image capability is off (initials are OK fallback, not a crash).
- Do not block on new recommendation algorithms — presentation/reliability only relative to history stamps and Continue parity.
- Fix intermittent empty rails when prefetch/background load races (ensure ready state surfaces items when seed arrives).

---

## 9. Track A slice sequence & acceptance criteria

Locked order: **progress honesty → soft-fallback stamp/promote → provider recovery → history delete → episode picker parity → shortcut chrome → recs/posters**.

### Slice A1 — ProgressEngagePolicy + dual gates

**Work:** Introduce shared policy; replace literals in `playback-history.ts`, `playback-progress-policy.ts`, `browse-idle-context.ts`; wire PlaybackPhase finalize/`last_watched_at` bump behind engage; DNS/stuck path skips last-watched poison.

**Accept:**

- Trusted >10s persists resume; ≤10s does not create Continue-eligible progress.
- Trusted >30s bumps `last_watched_at` and appears as browse idle Continue when unfinished.
- Stuck ~0 + duration > 0 does not change `last_watched_at`.
- Unit tests cover gate matrix without UI.

### Slice A2 — SoftFallbackPreferencePolicy + stamp alignment

**Work:** Promote only after engage; align ledger checkpoint provider id with `resolvedProviderId` on soft hop; continue vs search parity for hop + promote.

**Accept:**

- Soft hop sets session soft id, not durable prefs, before engage.
- After engage on soft winner, `titleProviderPreferences[canonicalId]` equals resolved id.
- Quit before engage after soft hop leaves durable prefs unchanged.
- Finalize + checkpoint rows store resolved provider id while hop active.

### Slice A3 — Provider recovery UX

**Work:** Browse palette IDs; Settings Storage row; title menu forget preference; **no** `F`/`Shift+F`.

**Accept:**

- From idle browse, `/reset-provider-health` and `/clear-cache` are runnable via palette.
- Settings Storage can reset provider health.
- Title menu clears per-title preference only for the focused title.
- Keybinding collision tests show no new F/Shift+F health bindings.

### Slice A4 — History delete UX

**Work:** `x` / `⇧X` + `y`/`Esc` confirm in history overlay; call `deleteProgressByKey` / `deleteTitle`; refresh idle Continue.

**Accept:**

- Episode delete removes one key only.
- Title delete removes all rows for `titleId`.
- Cancel leaves data intact.
- No multi-select.

### Slice A5 — Episode picker parity

**Work:** Pass `animeEpisodes` into `openActivePlaybackEpisodePicker`; share `previewBody`/stills when available.

**Accept:**

- Anime mid-play picker labels match PlaybackPhase/session-flow anime list when present.
- Preview rail content parity when stills/synopsis exist.
- Non-anime TMDB season switch unchanged.

### Slice A6 — Shortcut chrome + focus

**Work:** Glyph legend (`⇧`/`⌃`); registry case; stop destructive lowercasing; text-input / confirm focus isolation.

**Accept:**

- Footers/help show glyphs for shift/ctrl modifiers.
- Letter case matches registry entries for history delete chords.
- Confirm `y`/`Esc` does not type into browse search input.
- Letter hotkeys do not fire while search/command text owns focus.

### Slice A7 — Recs / posters

**Work:** Post-play `MiniPosterTile` / poster pipeline polish after stamps are trustworthy.

**Accept:**

- Recommendation rail tiles render when poster URLs exist and imaging is enabled.
- Missing posters do not crash post-play.
- Continue hero after engage still ranks correctly with posters present.

---

## 10. Track B — Search filter UX repair

### 10.1 Problem (root causes)

Filter **domain** (P6) exists (`FilterState`, `SearchIntentParser`, evidence badges), but browse **wiring is half-dead**:

| Rank | Root cause                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `/filters` hijacked in `browse-shell.tsx` → local narrow when results exist; **no-op when idle**; guided chip picker in `SearchPhase.chooseSearchFilterChip` is unreachable |
| 2    | Copy teaches invalid tokens: `type:anime`, `type:playlist`; parser accepts `mode:anime` and `type:movie                                                                     | series | all` only |
| 3    | Chip list offers `mode:youtube` but `SEARCH_MODES` omits `youtube` → silent unsupported                                                                                     |
| 4    | Library filters (`downloaded`, `watched`, `release`, …) often marked unsupported / string-heuristic theater — not real apply                                                |
| 5    | Bootstrap / early search can call `searchTitles(queryString)` and **drop** structured filters                                                                               |
| 6    | Ctrl+F substring narrow vs structured `FilterState` never unified in UX; clear-one-chip helpers exist with no UI                                                            |
| 7    | `getOptionType` / browse local apply miss Anime/YouTube shapes; genres/year-range gaps in `applyBrowseResultFilters`                                                        |

History/calendar type tabs are a **separate, healthier** axis — do not break them; align vocabulary at edges only.

### 10.2 Architecture (Approach 1)

```text
Tokens in query bar  ──┐
                       ├──► FilterState (canonical) ──► SearchRoutingService
Facet sheet (/filters) ┘         │                      upstream / local / unsupported
                                 │
                    Ctrl+F ──► resultFilter (substring only; distinct)
```

Locked command split:

| Command / key | Behavior                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `/filters`    | Open guided facet sheet (mutate `FilterState`; optional auto-search). Works **idle and with results**. |
| Ctrl+F        | “Narrow loaded results” substring only — never steal `/filters`.                                       |
| Typed tokens  | Shortcuts that mutate the same `FilterState`.                                                          |

### 10.3 Vocabulary locks

| User writes                               | System behavior                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `mode:anime\|series\|movie\|youtube\|all` | Parse and route                                                                                                                          |
| `type:anime`                              | **Alias → `mode:anime`** with calm correction chip/hint (or clear correction message) — never silent ignore                              |
| `type:movie\|series\|all`                 | Media type filter as today                                                                                                               |
| YouTube shapes                            | `type:video\|playlist\|channel` (or dedicated `shape:` key) — pick one in implementation plan; stop advertising tokens that do not parse |
| Stacked filters                           | `mode:anime year:2024 rating:7 genre:action` apply with honest badges                                                                    |

### 10.4 Apply honesty

- **upstream** → provider/registry request params
- **local** → typed post-filter on `SearchResult` fields (not fragile `previewMeta` bag-of-words)
- **unsupported** → visible; remove from facet UI for that source when never applicable

Library filters (`downloaded` / `watched` / `release`) either filter against enrichment/history facts or are unavailable in the facet UI for that source — no fake “applied” chrome.

### 10.5 Track B slices

#### Slice B1 — Parser + vocabulary + copy

**Work:** Accept `mode:youtube`; alias `type:anime` → `mode:anime`; YouTube content shapes; fix README / `browseEmptyDetail` / user docs; parser tests.

**Accept:** Advertised tokens parse or correct; no silent ignore for taught examples.

#### Slice B2 — `/filters` vs Ctrl+F command split

**Work:** Stop `handleLocalAction("filters")` hijack; wire palette `/filters` to facet sheet (`chooseSearchFilterChip` or browse-hosted sheet); Ctrl+F remains local narrow.

**Accept:** Idle `/filters` opens facets; with results `/filters` still opens facets; Ctrl+F only narrows.

#### Slice B3 — Single apply pipeline + bootstrap parity

**Work:** Always `searchTitles(intent)`; local apply on structured fields; evidence badges match; dead heuristic path retired or demoted.

**Accept:** Bootstrap/`-S` with tokens matches browse Enter; badges honest.

#### Slice B4 — Chip clear UX + sticky FilterState

**Work:** Show clearable chips; clear-one does not wipe others; Esc layers: narrow → chips → query (define exact Esc ladder in plan).

**Accept:** Clearing one chip keeps others; UI exposes clear.

#### Slice B5 — Library filters real or unavailable

**Work:** Implement local apply against enrichment/history **or** hide from facet UI per source; remove string-heuristic theater.

**Accept:** `downloaded:true` / `watched:*` either work or are not offered for that source.

### 10.6 Track B files (primary)

| File                                                                                                      | Role                                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/cli/src/domain/search/SearchIntentParser.ts`                                                        | Vocabulary                                  |
| `apps/cli/src/domain/search/SearchIntent.ts` / `SearchIntentEngine.ts`                                    | Model / chips                               |
| `apps/cli/src/services/search/SearchRoutingService.ts`                                                    | Apply + evidence                            |
| `apps/cli/src/app/search/SearchPhase.ts`                                                                  | Bootstrap intent; facet sheet               |
| `apps/cli/src/app-shell/browse-shell.tsx`                                                                 | Stop `/filters` hijack; chips UI            |
| `apps/cli/src/app-shell/browse-filters.ts`                                                                | Structured local apply or retire heuristics |
| `apps/cli/src/app-shell/browse-option-mappers.ts`                                                         | Stable typed kind                           |
| Copy: README, quickstart, `docs/users/commands-and-shortcuts.mdx`, `.plans/search-filter-state.md` status |

---

## 11. Testing strategy

Follow `.docs/testing-strategy.md`. Prefer unit tests at the policy boundary; shell tests for chords and delete confirm. Do **not** use `bun test` directly — `bun run test`.

### Track A

| Area                | Location                                                           | Coverage                                                      |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Dual gates / DNS    | `apps/cli/test/unit/domain/playback/`                              | Persist vs engage vs stuck matrix; `last_watched_at` omission |
| Soft preference     | `playback-provider-switch.test.ts` + PlaybackPhase/run-state tests | No promote pre-engage; promote post-engage; forget clears     |
| Ledger stamp        | ledger / PlaybackPhase unit tests                                  | Checkpoint provider id tracks resolved after hop              |
| Browse idle         | `browse-idle-context.test.ts`                                      | Engage threshold; ignores DNS rows                            |
| History delete      | `use-history-overlay-input.test.ts`, `history-shell.test.tsx`      | `x` / `Shift+X` / confirm / cancel                            |
| Episode picker      | `playback-episode-picker.test.ts` + ink-shell/picker tests         | `animeEpisodes` + previewBody path                            |
| Commands / settings | `command-registry` + workflow tests                                | Browse IDs include recovery; storage row invokes health reset |
| Keybindings         | `keybindings.test.ts`, `keybindings-collision.test.ts`             | Glyphs; no F/Shift+F health; case; text-input suppress        |
| Posters             | post-play shell / MiniPosterTile unit                              | Degraded path safe                                            |

### Track B

| Area                  | Location                         | Coverage                                   |
| --------------------- | -------------------------------- | ------------------------------------------ |
| Parser vocabulary     | `search-intent-parser.test.ts`   | `mode:youtube`, `type:anime` alias, shapes |
| Routing / evidence    | `search-routing.test.ts`         | Honest upstream/local/unsupported          |
| Browse action routing | browse-shell / SearchPhase tests | `/filters` → facets; Ctrl+F → narrow       |
| Bootstrap intent      | SearchPhase / integration unit   | Tokens not dropped                         |
| Chip clear            | browse-filters / shell tests     | Clear-one keeps others                     |

No live provider requirement for Track A slices 1–6 or Track B B1–B4. Poster and optional live search smoke remain opt-in.

---

## 12. Elements / files touched (Track A index)

### Policy & playback core

| File                                                                                         | Role                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| New shared policy module (under `apps/cli/src/domain/playback/` or `services/continuation/`) | `ProgressEngagePolicy`, `SoftFallbackPreferencePolicy` |
| `apps/cli/src/domain/playback/playback-history.ts`                                           | Persist gate via policy                                |
| `apps/cli/src/domain/playback/playback-progress-policy.ts`                                   | Resume-point gate via policy                           |
| `apps/cli/src/services/continuation/playback-history-ledger.ts`                              | Checkpoint/finalize provider alignment                 |
| `apps/cli/src/app/playback/PlaybackPhase.ts`                                                 | Soft hop, engage promote, stamp, last-watched          |
| `apps/cli/src/app/bootstrap/launch-entry.ts`                                                 | Continue/search preference apply parity                |
| `apps/cli/src/app/playback/playback-provider-switch.ts`                                      | Resolve/persist/forget title preference                |
| `apps/cli/src/app/playback/playback-run-state.ts`                                            | `sessionSoftProviderId` lifetime                       |

### Continue / history data

| File                                            | Role                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `apps/cli/src/app-shell/browse-idle-context.ts` | Continue hero uses engage gate                                      |
| `packages/storage/src/repositories/history.ts`  | `deleteProgressByKey`, `deleteTitle`, `last_watched_at` write paths |

### Recovery & commands

| File                                                            | Role                                     |
| --------------------------------------------------------------- | ---------------------------------------- |
| `apps/cli/src/app-shell/search-browse-command-ids.ts`           | Expose recovery in browse palette        |
| `apps/cli/src/domain/session/command-registry.ts`               | Canonical command defs (already present) |
| `apps/cli/src/app-shell/workflows/shell-workflows.ts`           | Handlers (already present)               |
| `apps/cli/src/app-shell/settings/registry/storage.ts`           | Reset provider health row                |
| `apps/cli/src/app-shell/title-control/title-control-actions.ts` | Forget preference + recovery actions     |

### History delete & chrome

| File                                                  | Role                                            |
| ----------------------------------------------------- | ----------------------------------------------- |
| `apps/cli/src/app-shell/history-shell.tsx`            | Confirm UI                                      |
| `apps/cli/src/app-shell/use-history-overlay-input.ts` | `x` / `Shift+X` / `y` / `Esc`                   |
| `apps/cli/src/app-shell/keybindings.ts`               | Bindings, `formatChord`, `footerKeyFromBinding` |
| `apps/cli/src/app-shell/browse-shell.tsx`             | Tab / input focus vs overlay confirm            |

### Episode picker

| File                                                            | Role                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `apps/cli/src/app/playback/playback-episode-picker.ts`          | Shared builder (already accepts `animeEpisodes`)         |
| `apps/cli/src/app-shell/pickers/tmdb-season-episode-pickers.ts` | Search/TMDB parity reference (`previewBody`)             |
| `apps/cli/src/app-shell/ink-shell.tsx`                          | `openActivePlaybackEpisodePicker` — pass `animeEpisodes` |

### Recs / posters

| File                                                   | Role                    |
| ------------------------------------------------------ | ----------------------- |
| `apps/cli/src/app-shell/post-play-shell.tsx`           | Mini poster rail        |
| `apps/cli/src/app-shell/primitives/MiniPosterTile.tsx` | Tile primitive          |
| Poster pipeline helpers used by post-play              | Capability-aware render |

---

## 13. Risks

1. **Gate conflation.** Teams historically used 10s and 30s interchangeably. Shipping without a single policy module will re-diverge Continue vs persist within a week. Mitigation: Approach 1 is mandatory; ban new magic numbers in review.
2. **Preference promote too early.** Promoting on soft hop (pre-engage) traps users on a lucky fallback after a failed primary flash. Mitigation: engage gate only; explicit user switch remains the only immediate durable write.
3. **Preference promote too late / never.** If engage evidence uses wall `watchedSeconds` instead of trusted progress, paused buffering could false-promote or never promote. Mitigation: policy inputs are **trusted** progress fields only.
4. **Checkpoint provider skew.** Mid-play checkpoints stamped with the failed primary while soft hop plays poison the next Continue launch. Mitigation: realign ledger context at hop time in the same slice as preference policy.
5. **DNS false negatives.** Treating all short quits as DNS could drop intentional “sample then quit” resumes. Mitigation: stuck ≈0 **with duration** is DNS; >10s trusted still persists resume without engage bump.
6. **History delete confirm focus leak.** `y` typed into browse search while confirm is pending. Mitigation: slice A6 focus isolation; overlay owns keys until resolved.
7. **Anime picker silent fallback.** Forgetting to pass `animeEpisodes` looks “fine” (numbers only) and ships as a regression. Mitigation: unit test that fails when anime list is omitted but available on session state.
8. **Recovery discoverability vs hotkey pressure.** Without `F`/`Shift+F`, users who only learn hotkeys may miss recovery. Mitigation: palette aliases (`clear-provider-memory`, `forget-provider-failures`), Settings row, title menu, and existing diagnostics copy pointing at `/reset-provider-health`.
9. **Poster slice masking reliability.** Doing posters first hides Continue bugs behind polish. Mitigation: locked order ends with recs/posters.
10. **Filter command confusion.** Shipping token fixes without splitting `/filters` vs Ctrl+F keeps teaching the wrong mental model. Mitigation: B2 before or with B1 copy updates.
11. **P6 plan status lie.** `.plans/search-filter-state.md` says implemented — Track B must update that truth index when landing.
12. **Interaction with binge prompt plan.** Prior plan promoted durable preference after a boundary prompt. This spec **narrows** soft-fallback promote to engage-gated automatic promote of the soft winner and keeps explicit user switches durable. Boundary prompts remain allowed as an additional explicit path; they must not bypass the “no promote on hop alone” rule.

---

## Locked decision index

| Decision            | Lock                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Package shape       | Track A slices A1–A7 + Track B slices B1–B5; Approach 1 both                                        |
| Soft fallback       | Allowed; promote title preference to soft winner **only after engage**                              |
| Dual gates          | >10s trusted = persist resume; >30s trusted = engage (Continue / last-watched / preference promote) |
| Stuck ~0 + duration | Did-not-start; do not poison `last_watched_at`                                                      |
| History stamps      | Finalize with `resolvedProviderId`; align checkpoint when soft hop active                           |
| History delete      | `x` episode, `⇧X` title, `y`/`Esc` confirm; multi-select later                                      |
| Provider recovery   | Palette + Settings Storage + title forget preference; **no** F/Shift+F                              |
| Legend              | `⇧` `⌃` glyphs; letter case from registry                                                           |
| Track A order       | A1 progress → A2 soft/stamp → A3 recovery → A4 delete → A5 picker → A6 chrome → A7 posters          |
| Continue vs search  | Soft fallback parity; promote after engage; expose recovery                                         |
| Search filters      | Separate Track B; `/filters` = facets; Ctrl+F = narrow; fix vocabulary; honest apply                |
| `type:anime`        | Alias to `mode:anime` with clear correction                                                         |
| Track B timing      | After A6 preferred; may parallelize after A3 with care                                              |
