# Ink Migration Plan

Status: **Superseded (baseline complete)**

Last reconciled: 2026-05-16

The Ink-based shell is the default runtime UI (`apps/cli/src/app-shell/*`). This plan is kept as historical context for the original migration intent.

**Remaining UI work** (do not re-run “add Ink” from scratch):

- [fullscreen-root-shell-redesign.md](./fullscreen-root-shell-redesign.md) — layout/chrome convergence
- [phase-1.8-single-mounted-content-tree.md](./phase-1.8-single-mounted-content-tree.md) — single mounted content tree
- [plan-implementation-truth.md](./plan-implementation-truth.md) — plan vs code index

Use this file only when auditing legacy ANSI paths or documenting risks (Kitty escape hatch, mpv stdio). Keep roadmap status in [`roadmap.md`](./roadmap.md).

## Goal

Replace the imperative ANSI rendering path with Ink so the CLI can support composable screens, overlays, and cleaner input handling.

## Why This Exists

- settings should be reachable from any screen
- current `stdout.write` flows are hard to compose safely
- `fzf` subprocess usage blocks a cleaner UI architecture

## Prerequisites

1. Replace the `fzf` binary dependency with the TypeScript `fzf` package
2. Extract shared design tokens so ANSI and Ink can share the same visual vocabulary

## Target Shape

`index.ts` becomes a thin state orchestrator and Ink owns rendering.

```ts
type AppState =
  | { screen: "gate" }
  | { screen: "search"; query: string }
  | { screen: "picking-title"; results: SearchResult[] }
  | { screen: "picking-season"; tmdbId: string }
  | { screen: "picking-episode"; tmdbId: string; season: number }
  | { screen: "resolving"; title: string }
  | { screen: "playing"; title: string; season: number; episode: number; provider: string }
  | { screen: "menu"; ctx: MenuContext }
  | { screen: "settings" };
```

## Screen Mapping

| Current flow           | Ink target           |
| ---------------------- | -------------------- |
| pre-search gate        | `SearchGate`         |
| search input           | text input component |
| title picker           | `FuzzyPicker`        |
| season/episode pickers | `FuzzyPicker`        |
| playback status        | `PlaybackStatus`     |
| post-episode menu      | `EpisodeMenu`        |
| settings               | `SettingsOverlay`    |
| history viewer         | `HistoryViewer`      |
| spinner                | spinner component    |
| poster output          | `Poster` passthrough |

## Delivery Phases

### Phase 1

- add Ink dependencies
- add shared design tokens
- prototype the new pickers and screens behind a feature flag

### Phase 2

- wire real state transitions into an Ink app shell
- replace `@clack` usage
- pause or unmount Ink cleanly while `mpv` owns the terminal

### Phase 3

- remove the flag
- remove old ANSI-only paths that are no longer needed
- update setup docs to drop the `fzf` binary requirement if applicable

## Risks

- Kitty image protocol may need a raw output escape hatch
- `mpv` with inherited stdio can interfere with Ink lifecycle
- stray manual cursor control sequences will fight Ink if left behind
