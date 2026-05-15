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
