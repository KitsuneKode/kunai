# KitsuneSnipe — Testing Strategy

Use this doc when adding tests, refactoring code to improve testability, or deciding what kind of test belongs to a change.

The goal is not "more tests" in the abstract. The goal is confident, maintainable tests that catch real regressions without turning the repo into a flaky lab.

## Repo Test Layout

- keep pure unit tests under `test/unit/`, mirrored by domain or feature area
- keep cross-module deterministic integration tests under `test/integration/`
- keep opt-in live provider smoke scripts under `test/live/`
- keep copyable templates for new contract tests under `test/templates/`
- keep VHS tapes and captured golden outputs under `test/vhs/` for UI demos and visual regression review

The published npm package already excludes the entire `test/` tree because `package.json` only ships `dist`, `README.md`, and `LICENSE`.

## Ink Render Harness (`apps/cli/test/harness/render-capture.ts`)

This repo deliberately does **not** use `ink-testing-library`. The local harness
covers what ITL cannot and re-implements the two pieces of ITL's API that are
worth keeping. Do not add `ink-testing-library` as a dependency.

### Why we don't use `ink-testing-library`

- ITL hardcodes `columns: 100`; the kanai shell needs to be tested at 72 / 100
  / 140 (rail collapse, two-pane layouts). ITL's `Stdout.columns` is a getter,
  not a setter, so resize cannot be simulated.
- ITL has no flicker probe. The shell has a real class of "loader desync /
  poster ghost / palette paging dance" bugs that are silent until you watch
  the frame count.
- ITL's `stdin.write()` is a silent no-op against our capture stream. It was
  the only thing worth porting, and we did — see `CaptureStdin.enqueue` below.

### What the local harness provides

| Helper                                  | Use it for                                        | Notes                                                                                                                       |
| --------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `captureFrame(node, { columns, rows })` | One-shot snapshot at a given width                | Trims trailing blank lines; deterministic.                                                                                  |
| `captureAllWidths(node)`                | Same node at 72 / 100 / 140                       | Returns `{ narrow, medium, wide }`.                                                                                         |
| `captureSurface(name, node)`            | Write `.txt` snapshots under `test/__captures__/` | For review diffs and committed goldens.                                                                                     |
| `captureResizeSequence(node, steps)`    | Simulate `useStdout` resize events                | Emits `stdout.emit("resize")`; Ink reads new `columns` from the stream.                                                     |
| `countCommits(node, { durationMs })`    | Real-time flicker probe                           | Real timers; use only for "is this surface calm?" assertions.                                                               |
| `simulateTicks(node, { rounds, tick })` | Deterministic flicker probe                       | Replaces `setInterval` with a shim that fires once per `act()` round. No real timers; commit count is exactly `1 + rounds`. |
| `render(node, { columns, rows })`       | Long-lived handle with `rerender` + `stdin`       | Use this to drive `useInput` from tests, change props, or read frame history.                                               |

### `render()` shape

Returns a `RenderHandle`:

```ts
{
  stdout: CaptureStdout;
  stdin: { enqueue(data): void; readonly buffered: boolean };
  width: number;       // remembered across rerender
  rows: number;
  lastFrame(): string; // same as stdout.lastFrame()
  frames: readonly string[]; // accumulated across rerenders
  rerender(next): void;
  unmount(): void;     // idempotent
}
```

Differences from `ink-testing-library`'s `Instance`:

- `stdin.enqueue` pushes a raw chunk (e.g. `"q"`, `"\r"`, `"\x1b[A"`) into the
  read buffer and emits `'readable'`. Ink's `App` subscribes to `readable`,
  not `data` (see `ink/build/components/App.js`), so emitting `readable` is
  what actually fires `useInput` callbacks.
- `width` and `rows` are remembered and re-applied on `rerender` so width
  assertions don't drift across prop changes.
- `frames` is an accumulator across remounts (a remount produces exactly two
  commits: the previous tree's final frame, and the new tree's initial frame).

### Determinism: prefer `simulateTicks` over `countCommits`

`countCommits` uses real `setTimeout`, which the testing-strategy doc already
forbids for new tests. The same property — "this surface commits at most N
frames in a window" — is provable with `simulateTicks` instead, with no time
dependence. Use `countCommits` only for the "is the surface calm?" idle
assertion where the exact frame count doesn't matter.

### Wiring `act`

The harness sets `IS_REACT_ACT_ENVIRONMENT = true` at the top of
`render-capture.ts` and wraps every mount / unmount / rerender / resize /
stdin-enqueue path in `act(...)` so React 19 state updates flush inside the
test boundary. The harness also installs a `setInterval` shim during
`simulateTicks` so interval-driven components advance exactly once per round.

If a new test introduces an "An update to X inside a test was not wrapped in
act(...)" warning, the fix is to either drive the update through the harness
(use `stdin.enqueue`, `simulateTicks`, or `rerender`) or wrap the raw update
in `act(() => { ... })` at the call site. Do not silence the warning with a
`process.stderr.write` filter.

## Audit-Driven Test Inventory

The shell test suite was audited and the gaps closed. The most recent pass
added the following tests and removed the following dead tests.

### Tests added in the audit pass

| File                                                                    | What it covers                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/test/unit/app-shell/render-capture.test.tsx` (extended)       | `render()` + `simulateTicks()` + `act()` wiring; the previous real-time `countCommits(Flickering)` test was timing-dependent, replaced with a deterministic 6-commit assertion.                                   |
| `apps/cli/test/unit/app-shell/input-router.useinput.test.tsx`           | First test to drive `useInput` through the harness. Asserts the router wires through correctly: Ctrl+C → hard-global, `/` in command-palette context → palette, `/` in text-input context → open-command-palette. |
| `apps/cli/test/unit/app-shell/dot-matrix-loader.test.tsx` (rewritten)   | Loader animation is interval-driven; replaced the real-time assertion with `simulateTicks` so the commit count is exact.                                                                                          |
| `apps/cli/test/unit/main-args.test.ts` (extended)                       | `--jump` / `--quick` / `-q` / `--continue` / `--history` / `--offline` parsing and invalid-input fallthrough.                                                                                                     |
| `apps/cli/test/unit/app-shell/help-overlay.test.tsx`                    | The "no-drift" contract from `keybindings.ts:7-9`: every live binding label is rendered in some tab, no hard-coded copy can reappear, and `HELP_TABS` matches the registry order.                                 |
| `apps/cli/test/unit/app-shell/post-play-h.useinput.test.tsx`            | P0-2 regression: `h` from the post-play surface routes to `onResolve("history")`; Ctrl+H does not; overlay-blocked `h` is dropped.                                                                                |
| `apps/cli/test/unit/app-shell/command-registry.coverage.test.ts`        | Every command id is reachable from at least one surface; aliases are globally unique; picker overlays only expose `diagnostics` + `help`.                                                                         |
| `apps/cli/test/unit/app-shell/resize-blocker.test.tsx`                  | The 60-col / 20-row blocked breakpoint, ResizeBlocker surface, and the resize-sequence harness path.                                                                                                              |
| `apps/cli/test/unit/app-shell/library-repair.test.ts`                   | B11: missing/invalid-file artifacts surface a status, a group issue count, and a footer explainer that tells the user to press `x` and re-add via `/download`.                                                    |
| `apps/cli/test/unit/app-shell/loading-shell-runtime.test.ts` (extended) | `shouldShowStallRecoveryPrompt` for the eternal-spinner case (no fallback, not cancellable, ≥ 20s).                                                                                                               |

### Tests removed in the audit pass

| File                                                        | Why it was removed                                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/test/unit/app-shell/checklist-shell.test.ts`      | 6 lines; tested only that `useLineEditor` is importable.                                                                                                                                            |
| `apps/cli/test/unit/app-shell/discover-shell.test.ts`       | 12 lines; tested a type alias, not behavior. The underlying `DiscoverShell` was also deleted (446 lines of dead code; the help overlay and setup tips advertised it but no caller ever mounted it). |
| `apps/cli/test/unit/app-shell/loading-shell.test.ts`        | 23 lines; tested `formatLoadingProviderLine` for 3 trivial cases. The same helper is covered more thoroughly by `loading-stage-mapping.test.ts` and `loading-shell-runtime.test.ts`.                |
| `apps/cli/test/unit/app-shell/loading-shell-layout.test.ts` | 13 lines; same helper as the file above, but only with different test data.                                                                                                                         |

The audit was conservative on removals: anything that asserted non-trivial
behavior on a real exported helper was kept. The four files above were the
only ones where the audit was unambiguous; the remaining 292 files were left
untouched.

## Core Principles

- test behavior, not incidental implementation structure
- prefer deterministic tests over integration theater
- isolate volatile network and provider drift behind fixtures and contracts
- keep slow or brittle end-to-end behavior out of the critical path unless it validates something no lower layer can

## Testing Pyramid For This Repo

### 1. Pure unit tests

Best target for:

- reducers and state transitions

- command availability logic
- recovery policy selection
- metadata mapping
- cache TTL and eviction logic
- formatting helpers
- provider ranking logic

These should be the cheapest and most common tests.

### 2. Service and contract tests

Best target for:

- `provider-resolution-service`
- `capability-service`
- `setup-guardrail-service`
- diagnostics report generation
- image preview state machine logic
- metadata caching behavior

Mock slow or external boundaries and assert on contract behavior.

### 3. Fixture-driven provider tests

Best target for:

- provider parsing and extraction rules
- subtitle inventory parsing
- quality / dub signal extraction
- network finding interpretation
- mirror inventory modeling

Use redacted stored fixtures whenever possible:

- HTML snapshots
- JSON payloads
- manifest samples
- simplified network traces

Do not require live sites for the default test path.

### 4. Focused integration tests

Best target for:

- shell event flow through one important interaction
- setup blocker to install-flow transitions
- overlay stack behavior
- playback handoff state transitions

Keep these few and high-signal.

### 5. Visual CLI tapes with VHS

Best target for:

- browse shell snapshots
- help and diagnostics overlays
- command palette discoverability
- before and after UX comparison for major shell redesign passes

Use VHS for terminal UX capture and review, not as the only proof that behavior works.

For this repo, treat VHS as the primary CLI e2e medium for visual flows.
Plain non-TTY process tests are often misleading for Ink UIs, so prefer:

- deterministic state tests for behavior
- VHS tapes for visible terminal UX
- live smoke scripts for provider/network reality

### 6. Manual or opt-in live verification

Reserve for:

- real provider drift checks
- image backend verification
- Playwright site behavior that cannot be responsibly frozen in fixtures

These should support development, but should not be the only form of safety.

Live provider smokes are intentionally excluded from CI, Husky hooks, and `bun run test`.
Run them only as an explicit release-candidate or provider-drift check. Each script must use
an isolated temporary XDG profile and print that profile in its JSON output so it never touches
the developer's real Kunai config, data DB, or cache DB.

The release gate for deterministic checks, provider smokes, Discord presence smoke, and manual
mpv playback is tracked in [release-reliability-gate.md](./release-reliability-gate.md).

Do not loop live smokes while iterating on a provider. Use fixture payloads, mocked fetch ports,
and provider contract tests for repeated runs, then perform one focused live smoke when the
deterministic seam is already green.

## Non-Flaky Test Rules

- avoid real timers unless the timer behavior itself is under test
- prefer fake clocks or extracted debounce policies
- avoid asserting on animation timing minutiae
- avoid relying on remote network conditions
- avoid terminal-size assumptions without explicitly controlling dimensions
- do not couple tests to unordered object iteration or unstable logging text

## What To Test For Shell Work

When changing shell behavior, focus on:

- launch arg parsing and bootstrap route selection
- hands-off search with `--jump` / `--quick`
- continue/resume target selection from local history
- history startup surface behavior
- offline library versus downloads queue routing
- command routing and availability
- overlay open/close rules
- focus retention
- resize degradation rules
- preview pane collapse rules
- companion pane selection behavior
- loading states:
  - empty
  - loading with previous data
  - ready
  - partial
  - error

## What To Test For Provider Work

When changing providers, focus on:

- title and episode mapping
- iframe/embed chain interpretation
- candidate stream inventory extraction
- subtitle track extraction
- quality and dub metadata extraction
- referer/header requirements
- rejection reasons for unusable candidates
- diagnostics output for failure stages

Prefer dossier-backed fixtures over hand-built guesses.

## What To Test For Data And Cache Work

- stable vs volatile data separation
- TTLs per data class
- LRU or eviction policy
- stale-while-revalidate behavior if introduced
- cancellation and deduplication of in-flight work
- bounded memory behavior

## Test Data Discipline

- keep raw sensitive provider artifacts out of durable fixtures unless scrubbed
- prefer redacted or reduced fixtures that still exercise the parser
- link provider fixtures to the provider dossier where practical
- keep sample cases for movies, series, anime, subtitles, dub/audio, and multi-source cases

## Recommended Outcomes By Change Type

| Change type                    | Minimum useful tests                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| New shell command or overlay   | state / reducer tests + one integration flow                               |
| Responsive layout rule         | deterministic layout-state tests                                           |
| Cache change                   | pure policy tests + service contract tests                                 |
| New provider                   | dossier + fixture-backed extraction tests + one integration path if needed |
| Subtitle or quality extraction | fixture-backed parser tests                                                |
| Diagnostics/report change      | contract tests for redaction and output shape                              |

## Release Reliability Gate

Default release checks stay deterministic and do not hit live providers or Discord:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run pkg:check
bun run build
```

Opt-in release-candidate smoke, run only when provider traffic is acceptable:

- one live provider smoke per active engine/provider family, using isolated XDG data/cache paths
- one real mpv playback smoke when playback, source switching, or auto-next changed
- Discord Rich Presence smoke only when presence code/config changed
- `/export-diagnostics` smoke after recovery/cache/download diagnostics changed

## Reliability-Seam Expectations

- Fire-and-forget async work must be routed through a background-task guard or have a local cleanup-only comment.
- Recoverable cache/provider/presence failures should record redacted diagnostics while preserving playback when possible.
- Source refresh tests must prove that voluntary refresh cooldown does not block broken-stream recovery, and that a failed fresh lookup can keep the current cached stream instead of stalling playback.
- Storage maintenance tests must seed durable user tables and disposable cache tables together, then prove automatic maintenance only prunes cache-class rows.
- Fake mpv IPC lifecycle tests cover app-side orchestration only; keep one manual real-mpv smoke for release candidates that touch playback.
- Live provider and Discord smokes are opt-in and must not be added to `bun run test`, CI, or Husky.

## Manual Smoke Matrix

Use these after meaningful shell or startup-route changes. They are not replacements for unit tests; they verify the real terminal experience.

| Flow                  | Command                                           | Expected first thing to verify                                       |
| --------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Interactive shell     | `bun run dev`                                     | Home/search shell opens and `/` command palette works                |
| Search results        | `bun run dev -- -S "Dune"`                        | Results load; playback does not auto-start                           |
| Search auto-pick      | `bun run dev -- -S "Dune" --jump 1`               | First result is selected and playback flow starts                    |
| Quick search          | `bun run dev -- -S "Dune" -q`                     | Same first-result behavior as `--jump 1`                             |
| Anime auto-pick       | `bun run dev -- -a -S "Attack on Titan" --jump 1` | Anime provider mode is active before title selection                 |
| Continue latest       | `bun run dev -- --continue`                       | Newest unfinished local history entry is chosen before provider work |
| History first         | `bun run dev -- --history`                        | History picker opens at startup                                      |
| Offline library first | `bun run dev -- --offline`                        | Completed local downloads picker opens, not the queue manager        |
| Queue manager         | In shell: `/downloads`                            | Queued/running/failed jobs are primary                               |
| Offline library       | In shell: `/library` or `/offline`                | Completed playable downloads are primary                             |
| Offline playback      | In `/library`: select a ready episode             | mpv starts from the local file; no provider fallback/resolve appears |
| Offline repair        | In `/library`: check/delete a missing artifact    | UI explains repair/re-download instead of silently going online      |
| Update panel          | In shell: `/update`                               | Manual guidance appears; no install command runs                     |
| Diagnostics export    | In shell: `/export-diagnostics`                   | Redacted support bundle is written locally                           |

`-S "Title"` alone is a search/results smoke test. Use `--jump N` or `-q` when the intent is to smoke-test hands-off playback.

## Implementation Advice

If something is painful to test, treat that as design feedback.

Prefer to extract:

- pure selectors
- state reducers
- policy functions
- parsing functions
- contract adapters

before writing tests that mock half the world.

For CLI UX:

- prefer VHS tapes over brittle pseudo-interactive assertions when the real need is visual review
- prefer deterministic state tests over VHS when the real need is behavior confidence
