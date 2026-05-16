# Plan vs Implementation Truth Index

**Last reconciled:** 2026-05-17

Use this file when a `.plans/*` status disagrees with the codebase. **Code wins** unless this index explicitly says otherwise. Update this file in the same change set when you complete or retire plan work.

## How agents should use this

1. Read [roadmap.md](./roadmap.md) for what is active vs parked.
2. Read **this file** before trusting `Status:` lines in older plans.
3. After landing behavior, update the relevant plan **and** a row here (or remove stale checklist items).

Canonical product/UX behavior lives in `.docs/*` when it describes **current** user-facing rules. `.plans/*` is for sequencing and remaining work.

---

## Stale or misleading plans (read before implementing)

| Plan                                                                                   | Plan header says | Code truth (2026-05-16)                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ink-migration.md](./ink-migration.md)                                                 | Planned          | **Baseline done.** Ink owns browse, playback, discover, overlays, pickers. Remaining work is layout convergence and phase loops, not “add Ink”.                                                                                                                                                             |
| [cli-ux-overhaul.md](./cli-ux-overhaul.md)                                             | Planned          | **Most product decisions implemented** via persistent shell. “Problems in current UX” largely describe pre-Ink prompt chains. Follow [persistent-shell-implementation.md](./persistent-shell-implementation.md) + [fullscreen-root-shell-redesign.md](./fullscreen-root-shell-redesign.md).                 |
| [ui-polish-and-image-protocol.md](./ui-polish-and-image-protocol.md)                   | pending          | **Partially done.** `image-pane.ts`, `poster-renderer.ts`, `use-poster-preview.ts`, Kitty placeholders in browse/playback. Remaining: flicker hardening, split `ink-shell.tsx`, footer/header pass.                                                                                                         |
| [persistent-shell-implementation.md](./persistent-shell-implementation.md)             | In Progress      | **Pass B/C largely landed** (root Ink host, root overlays, session pickers, resize blockers). **Not done:** single reducer-driven content tree ([phase-1.8](./phase-1.8-single-mounted-content-tree.md)), full back-stack, root-owned footer.                                                               |
| [phase-1.8-single-mounted-content-tree.md](./phase-1.8-single-mounted-content-tree.md) | Planned          | **In progress.** Phase 1.5 foundation exists; browse/playback still transition via `SearchPhase` / `PlaybackPhase` loops.                                                                                                                                                                                   |
| [beta-ui-provider-runtime-hardening.md](./beta-ui-provider-runtime-hardening.md)       | (no top status)  | **In progress.** Tasks 1–7 largely complete (`use-session-selector`, `picker-controller`, `picker-overlay`, `PlaybackResolveService`, source inventory, `CatalogDiscoveryService`). Open: central input routing step 2, subtitle call avoidance, split `ink-shell`, history panel, dub/sub display honesty. |
| [catalog-release-schedule-service.md](./catalog-release-schedule-service.md)           | in progress      | **Slices 1–4 largely done** (`CatalogScheduleService`, SQLite `schedule_cache`, `/calendar`, anime week window). Open: date-group headers, week navigation, TMDB weekly TV, browse schedule badges.                                                                                                         |

---

## Implemented capabilities (plans often still list as future)

| Capability                                                            | Canonical code                                                                               | Notes                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Ink app shell                                                         | `apps/cli/src/app-shell/ink-shell.tsx`, `shell-frame.tsx`                                    | Single module-level Ink root; not one reducer tree yet                                             |
| Design tokens                                                         | `packages/design/src/tokens.ts`, `shell-theme.ts`                                            |                                                                                                    |
| `/discover`, `/calendar`, `/random`                                   | `discover-shell.tsx`, `calendar-results.ts`, `random-results.ts`, `command-registry.ts`      | Lazy-loaded; see [.docs/recommendations-and-discover.md](../.docs/recommendations-and-discover.md) |
| Root overlays (settings, provider, history, diagnostics, help, about) | `root-overlay-shell.tsx`, `overlay-panel.tsx`                                                |                                                                                                    |
| Session pickers (season, episode, subtitle, …)                        | `session-picker.ts`, `openSessionPicker`, `picker-overlay.tsx`                               | `root-picker-bridge.ts` **removed**                                                                |
| Viewport policy + resize blockers                                     | `layout-policy.ts`, `use-viewport-policy.ts`, `ResizeBlocker`                                | Per-shell minimums; debounced resize                                                               |
| `minimalMode`, footer modes                                           | config + `ink-shell.tsx`                                                                     |                                                                                                    |
| Poster preview (non-blocking)                                         | `image-pane.ts`, `use-poster-preview.ts`                                                     | Flicker on resize still tracked                                                                    |
| Playback resolve + source inventory                                   | `PlaybackResolveService.ts`, inventory service/tests                                         |                                                                                                    |
| Catalog schedule + calendar                                           | `CatalogScheduleService.ts`, `schedule-cache` repository                                     |                                                                                                    |
| Shell responsiveness pass                                             | [shell-responsiveness-and-polish-pass.md](./shell-responsiveness-and-polish-pass.md)         | Marked completed 2026-05-16                                                                        |
| Reliability core hardening                                            | [reliability-core-autonomous-sweep.md](./reliability-core-autonomous-sweep.md)               | Fake mpv harness, PlayerControl ordering tests, release gate, live smoke scripts                   |
| Codebase coherence sweep                                              | [codebase-coherence-and-redundancy-report.md](./codebase-coherence-and-redundancy-report.md) | README/PR checklist/release gate coherence, debugging map, deferred architecture report            |

---

## Active tracks (accurate status)

| Track                          | Status                                            | Source of truth                                                                                      |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Daily-use UX hardening         | Implementation pass done; manual smoke + doc sync | [daily-use-ux-discovery-and-runtime-hardening.md](./daily-use-ux-discovery-and-runtime-hardening.md) |
| Fullscreen root shell redesign | In progress (slices 1–2 partial)                  | [fullscreen-root-shell-redesign.md](./fullscreen-root-shell-redesign.md)                             |
| Phase 1.8 content tree         | In progress                                       | [phase-1.8-single-mounted-content-tree.md](./phase-1.8-single-mounted-content-tree.md)               |
| Beta UI/provider hardening     | In progress (tasks 8–10)                          | [beta-ui-provider-runtime-hardening.md](./beta-ui-provider-runtime-hardening.md)                     |
| Catalog schedule polish        | In progress (calendar UX + browse badges)         | [catalog-release-schedule-service.md](./catalog-release-schedule-service.md)                         |
| Design system + Discover       | Polish / verification                             | [kitsune-design-system-and-recommendations.md](./kitsune-design-system-and-recommendations.md)       |
| Reliability/coherence path     | Implemented; use report for next sweep            | [codebase-coherence-and-redundancy-report.md](./codebase-coherence-and-redundancy-report.md)         |

---

## Known gaps (called out in plans, still open in code)

- **Recommendation cache on upstream failure** — daily-use Milestone 1 exit criteria (stale-on-error, no poisoned empty cache) not clearly isolated in `RecommendationServiceImpl`; verify before marking plan done.
- **Discover empty states** — section-level `"Nothing here yet"` exists; dedicated copy for no-history / TMDB failure / no-similar-titles may still need product pass.
- **Nested card chrome** — fullscreen redesign slice 2; child shells may still draw redundant borders.
- **Single mounted content tree** — browse/playback phase loops vs always-mounted reducer state.
- **Central input routing** — beta-ui Task 6 step 2 unchecked.
- **Split `ink-shell.tsx`** — beta-ui Task 10; file still large.
- **Image flicker on terminal shrink** — explicit cleanup in `ink-shell.tsx` comments; image-pane ownership incomplete.
- **Trace/event correlation** — diagnostics, debug JSONL, background task errors, and provider/player telemetry do not yet share a single correlation id model.

---

## Doc hygiene rules (prevent drift)

- When `Status: Planned` but code exists, change plan status to **In progress**, **Partially complete**, or **Superseded** — do not leave `Planned`.
- Move completed checklist items to a **Completed** section with date; do not leave unchecked boxes for shipped work.
- Prefer updating [.docs/recommendations-and-discover.md](../.docs/recommendations-and-discover.md) (and similar) for **behavior truth**; use `.plans` for **remaining slices**.
- Roadmap [roadmap.md](./roadmap.md) stays short; this file holds reconciliation detail.
- After any UI/architecture pass, run: `bun run typecheck`, `bun run lint`, and update this file if plan status changed.

---

## Related canonical docs (usually fresher than old plans)

- [.docs/ux-architecture.md](../.docs/ux-architecture.md) — interaction rules
- [.docs/design-system.md](../.docs/design-system.md) — tokens and shell UX standard
- [.docs/recommendations-and-discover.md](../.docs/recommendations-and-discover.md) — discover/calendar/random **as implemented**
- [.docs/poster-image-rendering.md](../.docs/poster-image-rendering.md) — image subsystem map
