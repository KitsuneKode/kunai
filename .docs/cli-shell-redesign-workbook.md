# Kunai CLI Shell — Design Agent Workbook

Use this with the interactive atlas: [cli-shell-ui-atlas.html](./cli-shell-ui-atlas.html).

**Goal:** Redesign the Ink terminal shell with **no surface left undocumented**. The registry below is the coverage checklist; mark each row in the atlas (Registry tab) as you work.

---

## Design north star (from product code)

From [.docs/design-system.md](./design-system.md):

- Calm, fast **media command shell** — content-first, diagnostics only on demand
- **One** context strip per screen (mode · provider · episode · filters) — do not repeat in header, badges, detail, and footer
- **Amber** = primary action / selection · **Teal** = info/status · **Green/Red** = real success/failure only
- Footer: **3–4 live keys** + `/ commands`, not paragraph shortcuts
- Tokens: `packages/design/src/tokens.ts` → `apps/cli/src/app-shell/shell-theme.ts`

**Terminal motion (adapted for CLI):** No animation on high-frequency keys (`/`, `j`/`k`, palette navigation). Animate rare overlays (setup, exit, first open of a modal) under **200ms**, `ease-out`, never `transition: all`. Selection moves are instant (teal bar), not tweened.

**References to study (taste, not copy):**

| System                                                                 | Borrow                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Raycast](https://raycast.com)                                         | Command palette density, zero animation on repeat actions, footer discipline      |
| [Linear](https://linear.app)                                           | Hierarchy, one primary action, quiet secondary text                               |
| [Sonner](https://sonner.emilkowal.ski)                                 | Cohesive motion personality (elegant `ease`, not bouncy) for rare toasts/overlays |
| [iA Writer](https://ia.net)                                            | Terminal calm — typography and margins over chrome                                |
| [Stripe Dashboard](https://stripe.com)                                 | Status semantics, error panels with clear next step                               |
| [ani-cli / terminal anime CLIs](https://github.com/pystardust/ani-cli) | Audience expectation for anime mode density                                       |

---

## Layer model (compositor)

```text
SessionController
  SearchPhase  → mountRootContent(browse) | mountShell(discover) | calendar payloads
  PlaybackPhase → openLoadingShell | openPlaybackShell | openSessionPicker overlays

resolveRootShellSurface():
  error → ErrorShell
  playback + overlay → root-overlay (RootOverlayShell)
  playback → PlaybackShell / PostPlayShell
  mountRootContent → browse | playback | picker (ListShell, Stats, Setup, Checklist)
  mountShell → DiscoverShell, LoadingShell (stacked)
  idle → RootIdleShell
```

**Stacking:** `activeModals[]` + `commandBar` are independent. Esc: close palette → pop overlay (`resolveEscTransition`).

---

## Surface registry (complete checklist)

Status values for redesign pass: `inventory` · `in-scope` · `exploring` · `approved` · `skip`

| ID  | Surface                                     | Category       | Primary source                        | Mock in atlas?                      |
| --- | ------------------------------------------- | -------------- | ------------------------------------- | ----------------------------------- |
| S01 | BrowseShell — search idle                   | Primary browse | `ink-shell.tsx` BrowseShell           | Yes (A)                             |
| S02 | BrowseShell — results + filters + companion | Primary browse | `ink-shell.tsx`                       | Yes (B)                             |
| S03 | BrowseShell — command palette               | Global chrome  | `shell-command-ui.tsx`                | Yes (C)                             |
| S04 | BrowseShell — `/recommendation` list        | Primary browse | `loadRecommendations()`               | Yes (D)                             |
| S05 | BrowseShell — trending discovery load       | Primary browse | `loadDiscovery()`                     | Partial (Discover group)            |
| S06 | BrowseShell — calendar schedule             | Primary browse | `calendar-ui.tsx`                     | Yes (calendar)                      |
| S07 | BrowseShell — details overlay               | Browse overlay | `BrowseOverlay` type `details`        | No                                  |
| S08 | BrowseShell — provider overlay (inline)     | Browse overlay | `BrowseOverlay` type `provider`       | No                                  |
| S09 | BrowseShell — history-picker (inline)       | Browse overlay | `BrowseOverlay` type `history-picker` | No                                  |
| S10 | BrowseShell — settings overlay (inline)     | Browse overlay | `BrowseOverlay` type `settings`       | Partial (settings in root-overlays) |
| S11 | BrowseShell — settings-choice drill-down    | Browse overlay | `settings-choice`                     | No                                  |
| S12 | BrowseShell — episode-picker (inline)       | Browse overlay | `BrowseOverlay` type `episode-picker` | No                                  |
| S13 | BrowseShell — idle footer hints             | Primary browse | `browse-idle-actions`, config         | No                                  |
| S14 | DiscoverShell — multi-rail                  | Mounted screen | `discover-shell.tsx`                  | Yes                                 |
| S15 | DiscoverShell — section reroll / refresh    | Mounted screen | `discover-shell.tsx`                  | No                                  |
| S16 | LoadingShell — 4-stage resolve rail         | Transient      | `loading-shell.tsx`                   | Yes                                 |
| S17 | LoadingShell — playback supervision strip   | Transient      | `loading-shell-runtime.ts`            | Yes                                 |
| S18 | LoadingShell — poster companion (wide)      | Transient      | `loading-shell.tsx`                   | Partial                             |
| S19 | PlaybackShell — post-play frame             | Post-play      | `ink-shell.tsx` PlaybackShell         | Yes                                 |
| S20 | PostPlayShell — mid-series + up next        | Post-play      | `post-play-shell.tsx`                 | Yes                                 |
| S21 | PostPlayShell — stopped early / resume      | Post-play      | `post-play-shell.tsx`                 | Yes                                 |
| S22 | PostPlayShell — rec rail wide (1–3)         | Post-play      | `post-play-shell.tsx`                 | Yes                                 |
| S23 | PostPlayShell — rec rail hidden (narrow)    | Post-play      | `post-play-shell.tsx`                 | Yes                                 |
| S24 | PostPlayShell — series-complete condensed   | Post-play      | `post-play-shell.tsx`                 | Yes                                 |
| S25 | PostPlayShell — season-finale               | Post-play      | `post-play-shell.tsx`                 | No                                  |
| S26 | PostPlayShell — caught-up + calendar hint   | Post-play      | `post-play-shell.tsx`                 | No                                  |
| S27 | PostPlayShell — movie complete              | Post-play      | `post-play-shell.tsx`                 | No                                  |
| S28 | RootOverlayShell — Help (tabbed)            | Root overlay   | `root-overlay-shell.tsx`              | Partial                             |
| S29 | RootOverlayShell — About                    | Root overlay   | `panel-data.ts`                       | No                                  |
| S30 | RootOverlayShell — Diagnostics              | Root overlay   | `panel-data.ts`                       | No                                  |
| S31 | RootOverlayShell — Settings list            | Root overlay   | `overlay-panel.tsx`                   | Partial                             |
| S32 | RootOverlayShell — Settings nested choices  | Root overlay   | `workflows.ts` openSettingsShell      | No                                  |
| S33 | RootOverlayShell — History picker           | Root overlay   | `root-overlay-shell.tsx`              | Partial                             |
| S34 | RootOverlayShell — Notifications            | Root overlay   | `notification-overlay-model.ts`       | No                                  |
| S35 | RootOverlayShell — Downloads                | Root overlay   | `download-manager-shell.tsx`          | Partial                             |
| S36 | RootOverlayShell — Library                  | Root overlay   | `library-shell.tsx`                   | Partial                             |
| S37 | RootOverlayShell — Provider picker          | Root overlay   | `SessionState` overlay                | No                                  |
| S38 | PickerOverlay — source/quality/subtitle     | Session picker | `picker-overlay.tsx`                  | Yes                                 |
| S39 | PickerOverlay — season / episode            | Session picker | `session-picker.ts`                   | Partial (ListShell)                 |
| S40 | PickerOverlay — recommendation_picker       | Session picker | `command-router.ts`                   | No                                  |
| S41 | ListShell — generic confirm / pick          | Picker mount   | `ink-shell.tsx` ListShell             | Partial                             |
| S42 | ListShell — handoff URL confirm             | Picker         | `workflows.ts`                        | No                                  |
| S43 | ListShell — post-play rec actions panel     | Picker         | `PlaybackPhase.ts`                    | No                                  |
| S44 | ListShell — static info (docs/export)       | Picker         | `openStaticInfoShell`                 | No                                  |
| S45 | ListShell — update / version                | Picker         | `openUpdateShell`                     | No                                  |
| S46 | ListShell — episode history per title       | Picker         | `openEpisodeHistoryShell`             | No                                  |
| S47 | ListShell — download/offline confirmations  | Picker         | `workflows.ts`                        | No                                  |
| S48 | ChecklistShell — batch episode download     | Picker         | `checklist-shell.tsx`                 | Yes                                 |
| S49 | SetupShell — onboarding slides (6)          | Onboarding     | `setup-shell.tsx`                     | Partial (1 slide)                   |
| S50 | StatsShell — heatmap + top shows            | Feature        | `ink-shell.tsx` StatsShell            | Partial                             |
| S51 | LibraryShell — offline groups               | Feature        | `library-shell.tsx`                   | Partial                             |
| S52 | DownloadManagerContent — job queue          | Feature        | `download-manager-shell.tsx`          | No                                  |
| S53 | ErrorShell — playback failure scenarios     | Error          | `root-status-shells.tsx`              | Yes                                 |
| S54 | RootIdleShell — welcome / paused session    | Idle           | `root-status-shells.tsx`              | Yes                                 |
| S55 | ExitShell — graceful quit animation         | Exit           | `exit-shell.tsx`                      | No                                  |
| S56 | ResizeBlocker — terminal too small          | System         | `shell-primitives.tsx`                | Yes                                 |
| S57 | ShellFrame — header/eyebrow/footer shell    | Chrome         | `shell-frame.tsx`                     | Implicit in mocks                   |
| S58 | ShellFooter — key legend                    | Chrome         | `shell-primitives.tsx`                | Implicit                            |
| S59 | ContextStrip — stable metadata row          | Chrome         | `shell-primitives.tsx`                | No                                  |
| S60 | DetailsPaneUI — browse companion            | Chrome         | `details-pane-ui.tsx`                 | Partial (companion)                 |
| S61 | CommandPalette — fuzzy command list         | Chrome         | `shell-command-ui.tsx`                | Partial                             |
| S62 | Poster preview / Kitty image pane           | Chrome         | `use-poster-preview`, `image-pane`    | No                                  |
| S63 | Session confirm overlay                     | Modal          | `OverlayState` type `confirm`         | No                                  |
| S64 | Setup overlay (missing deps)                | Modal          | `OverlayState` type `setup`           | No                                  |
| S65 | TMDB season/episode pickers                 | Picker         | `tmdb-season-episode-pickers.ts`      | Partial                             |
| S66 | Playback — active chrome (mpv running)      | Playback       | PlaybackPhase feedback                | Yes                                 |
| S67 | Recommendation — before/after map           | Meta           | workbook + atlas                      | Yes                                 |

**Coverage today:** ~28 surfaces have mocks or partial mocks · **~39 need new mocks** for a full visual pass.

---

## Shared components (redesign once, apply everywhere)

| Component     | Rule                                                                 |
| ------------- | -------------------------------------------------------------------- |
| Selection row | Teal fill + `❯` — same in Browse, ListShell, PickerOverlay, Settings |
| Filter field  | Label + underline + amber cursor — same width policy                 |
| Footer        | Task line + amber keys; primary key uses `amberSoft`                 |
| Round panel   | `borderStyle round` for resume / next / errors — concentric padding  |
| Empty state   | One line problem + one line action — no walls of text                |
| Loading       | Stage rail dots — don't add spinner on every row update              |

---

## Engineering constraints (do not break)

- Episode numbers **1-based** in UI
- `routeShellInput`: hard quit Ctrl+C; `/` opens palette when not in modal
- Narrow terminal: companion pane and post-play rec rail **hide** — design narrow states explicitly
- Ink alternate screen — avoid raw ANSI clear (flicker)
- Footer modes: `detailed` vs `minimal` (`-m` CLI flag)

---

## Your direction (fill in atlas → Direction tab)

Persisted in browser `localStorage` under `kunai-shell-redesign-v1`:

- **Taste:** what you love / hate in terminal UIs
- **In scope:** surface IDs you are redesigning this pass
- **References:** links and notes
- **Non-goals:** what stays as-is

Export JSON from atlas for handoff to another agent.

---

## Handoff prompt (paste to design agent)

```text
You are redesigning Kunai's Ink CLI shell. Read:
- .docs/cli-shell-redesign-workbook.md (full surface registry)
- .docs/design-system.md (tokens + shell UX standard)
- .docs/cli-shell-ui-atlas.html (mocks + Registry tab statuses)

Rules: calm command shell, amber/teal semantics, no repeated context, footer teaches keys.
Do not animate keyboard navigation. Every registry row must end in-scope → approved or skip with reason.
Implement in apps/cli/src/app-shell/* and packages/design/src/tokens.ts only when token values change.
```
