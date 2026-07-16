# Search-Ready Startup and Stats Repair Design

## Goal

Make a normal interactive Kunai launch become useful at the first shell paint,
restore `/stats` as a real user-facing command, and polish the nearby feedback
without expanding into a dashboard or broad shell redesign.

The normal no-query launch should open a focused search-ready browse surface.
Existing personal return-loop rows such as Continue Watching, Up Next, offline
ready items, and release nudges appear after that first paint when available,
but they must not steal focus, erase typed text, or move the user into another
interaction zone.

## Confirmed Problems

### `/stats` is implemented but unreachable

The command registry, shell workflow, stats service, formatter, and stats shell
still exist. The missing behavior comes from command-surface filtering:

- `SEARCH_BROWSE_COMMAND_IDS` omits `stats`.
- the curated post-play command list omits `stats`.
- the root-overlay and active-playback registry contexts omit `stats`.
- the help panel omits `stats`.
- command coverage currently classifies `stats` as a handler-only exception even
  though no keyboard-only route makes it reachable.
- the post-play router test explicitly expects `stats` to be absent.

This is command-model drift, not a removed product capability.

### Startup paints shell chrome before usable search

`main.ts` mounts the persistent Ink host, but the focused browse input is owned
by `SearchPhase` and arrives later. The path between those events includes work
that is not required for a normal completed-onboarding launch:

- `maybeRunSetupWizard` imports a workflow module before checking whether setup
  is needed.
- the command dispatcher statically imports the broad workflow barrel and setup
  workflow, so importing the search phase also evaluates command UI that is
  unused during ordinary startup.
- search-phase preparation builds display and personal context before mounting
  the browse shell.

An isolated local timing probe measured the Ink shell import at roughly 123 ms.
That number is diagnostic evidence, not a permanent performance threshold; the
dependency installation was not reconciled with the user's current lockfile
changes, so the implementation must repeat measurements after the local install
matches the lockfile.

## Scope

This is one bounded CLI shell slice:

1. restore command reachability and truthful coverage for `/stats`;
2. shorten the normal interactive startup critical path;
3. make the focused search input the first useful interactive surface;
4. hydrate existing personal return-loop context without disrupting input;
5. improve the immediate loading, empty-state, and command-hint feedback touched
   by this flow;
6. add deterministic regression coverage and startup diagnostics.

No provider behavior, playback resolution policy, storage schema, stats
aggregation semantics, recommendation fetching, or docs-site redesign belongs
in this slice.

## Command Reachability Design

`stats` becomes an ordinary non-destructive personal command.

It must be available from:

- the browse/search command palette;
- root-owned list and overlay surfaces that use the normal root-overlay command
  context;
- active playback;
- post-playback;
- the help panel's panels-and-commands section.

Focused media pickers remain intentionally restricted to `diagnostics` and
`help`; `/stats` does not enter those local picker palettes.

All surfaces continue to route the action through the existing
`dispatchPaletteCommand` and `handleStats` path. The implementation must not add
a second stats handler or a special keyboard shortcut.

The coverage test must stop treating `stats` as handler-only. Surface tests must
assert its presence, and a routing test must exercise the real browse palette
action path far enough to prove the existing stats workflow is selected.

## Startup Architecture

### 1. Use one setup-startup policy

Extract the setup-needed decision into a small pure policy shared by
`main.ts` and `runSetupWizard`. Its inputs are the explicit `--setup` force flag,
`onboardingVersion`, and `downloadOnboardingDismissed`.

`main.ts` reads the already-loaded config snapshot first. When setup is not
needed, it returns without importing setup UI or workflow modules. When setup is
needed, it dynamically imports the focused setup workflow module rather than
the broad workflow barrel.

The setup workflow repeats the shared policy check as a defensive boundary so
direct callers retain the current behavior.

### 2. Make command workflows demand-loaded

`dispatch-palette-command.ts` must not statically import the broad workflow
barrel or setup workflow. Workflow-only code is dynamically imported when a
matching command is actually dispatched.

This preserves one canonical dispatcher while preventing stats, sync, cache,
download, setup, and other command implementations from joining the ordinary
search startup module graph.

Quit handling uses the same lazy workflow boundary because no quit decision is
needed to paint the initial search surface.

### 3. Mount browse before optional personal projection

The search phase must prepare only the state required to open `BrowseShell`:
mode, provider, current query/results, commands, placeholder, and callbacks.

For an empty normal launch:

- skip result enrichment because there are no results to enrich;
- mount the browse shell immediately with its query input focused;
- start loading the existing local personal return-loop projection after the
  shell mount;
- update the browse shell through one explicit asynchronous idle-context input.

The idle-context update must be guarded against unmount and stale requests.
It must preserve the current query, cursor, command mode, results, and focus
zone. If the user has started typing, personal rows may appear below the input
but cannot become selected automatically.

The personal projection remains local and best-effort. Failure removes the
temporary hint quietly and records debug diagnostics; it does not produce a
blocking error or network retry.

No new persisted recent-search system is introduced. This slice hydrates the
existing Continue Watching, Up Next, offline-ready, and release/calendar
return-loop data only.

### 4. Keep explicit startup routes truthful

Explicit launch intents keep their current semantics:

- `--setup` opens setup;
- `--history` opens history first;
- `--offline` opens the offline library;
- `--continue` resolves the continuation target;
- `--calendar`, `--discover`, and `--random` load their requested route;
- `-S`, `--jump`, and quick search preserve their current bootstrap behavior.

The search-ready-first rule applies to the ordinary no-query interactive launch.
It must not flash a search input over an explicitly requested startup overlay or
route.

## First-Paint Experience

The first useful normal frame contains:

- the canonical header;
- a focused search field with the current mode-appropriate placeholder;
- concise copy equivalent to `Type a title · / commands`;
- no full-screen loader and no animated decoration required before typing.

If local personal context remains unresolved for 150 ms, the browse body shows
one quiet, stable line: `Loading your local shortcuts…`. It disappears when the
projection resolves. It must not animate every frame or push the search field
to a different row. Context that resolves within 150 ms produces no loading
flash.

Existing empty-state and return-loop copy is adjusted only where needed to make
these states distinct:

- ready to search;
- loading local shortcuts;
- search request in progress;
- no matching results;
- local shortcut load failed.

The command palette continues to open with `/`, and `/stats` is
discoverable by typing `stats` or `statistics`.

## Diagnostics and Measurement

Debug startup evidence must distinguish:

1. shell module loaded;
2. persistent shell mounted;
3. browse search surface mounted;
4. local idle context ready.

The implementation uses existing logger/diagnostics infrastructure and must not
record query text, title names, file paths, or other private user data in timing
events.

Tests assert ordering and non-blocking behavior rather than a machine-specific
millisecond ceiling. Manual verification records comparative timings from the
same machine and install before and after the change.

## Error Handling

- A setup-policy read failure falls back to the existing safe setup behavior;
  it must not silently mark onboarding complete.
- A dynamic workflow import failure stays inside the existing dispatcher error
  path and results in truthful shell feedback rather than an unhandled promise
  rejection.
- Personal idle-context failures are recoverable and non-blocking.
- Stats shell failures continue through the shared workflow error handling; no
  partial replacement stats UI is added.
- Startup optimization must not bypass dependency checks, container creation,
  config initialization, or explicit startup intents.

## Testing Strategy

Follow red-green-refactor with the repository's Bun test runner and local
render-capture harness.

### Command tests

- change the browse and post-play surface expectations so they contain `stats`;
- assert root-overlay and active-playback contexts contain `stats`;
- remove `stats` from the handler-only coverage allowlist;
- assert the help panel includes `/stats`;
- route a browse `stats` action through the real command router with the stats
  workflow boundary stubbed at its narrow import seam.

### Setup and import-boundary tests

- pure policy cases cover forced setup, stale onboarding, incomplete download
  onboarding, and completed onboarding;
- completed onboarding proves the setup workflow loader is not called;
- required onboarding proves the loader is called once;
- command dispatcher tests prove workflow code is loaded only for workflow
  actions and not for ordinary palette resolution.

### First-paint tests

Use `apps/cli/test/harness/render-capture.ts`, not
`ink-testing-library` or real-time sleeps.

- the initial normal browse capture contains the focused search-ready state
  before a deferred idle-context promise resolves;
- typed text survives idle-context resolution;
- focus stays on query input;
- resolved personal rows become visible without replacing search results;
- rejected idle-context loading leaves a usable search surface;
- explicit startup routes do not render the normal search-ready state first.

### Verification

Run focused package-local tests first, followed by:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run build
bun run test
```

The local dependency installation must match the user's current lockfile before
claiming full verification. Existing unrelated edits to
`apps/docs/lib/generated-metadata.json`, `apps/docs/package.json`, `package.json`,
and `bun.lock` must be preserved and excluded from this feature's commits.

## Acceptance Criteria

1. `/stats` is visible and dispatchable from browse, normal root overlays,
   active playback, and post-playback.
2. Help lists `/stats`, while focused media-picker palettes remain restricted.
3. Command coverage no longer labels `stats` as an unreachable handler-only
   exception.
4. A completed-onboarding normal launch does not import setup UI or the broad
   workflow barrel before the browse surface is usable.
5. The normal no-query launch reaches a focused browse search input before
   optional personal return-loop projection finishes.
6. Typing before personal context resolves preserves the query and input focus.
7. Personal projection failure never blocks search.
8. Explicit startup routes preserve their existing first-surface behavior.
9. Startup diagnostics show ordered shell-mounted, browse-mounted, and
   idle-context-ready stages without private content.
10. Focused tests and all available repository gates pass after dependency
    reconciliation.
