# Kunai — Agent Entry Point

Kunai is a terminal-first Bun CLI that finds playable direct-provider video
streams and hands them off to `mpv`.

`CLAUDE.md` is a symlink to this file. Edit this one.

## Start here

1. **Find the code** — [.docs/feature-map.md](.docs/feature-map.md) routes any
   user-visible feature to the directory that owns it. Use it before grepping.
2. **Read the code.** It is the only source of truth. Docs describe intent and
   constraints; when they disagree with the tree, the tree wins and the doc is
   the bug.
3. **Check the boundaries below** if your change crosses a layer, a package, or
   the provider seam.

Do not read `.docs/` end to end. Route to the one or two files your change
touches.

## Non-negotiables

Each of these is enforced or expensive to get wrong. Everything else is
judgment.

- **Layering is a test, not a convention.**
  `apps/cli/test/unit/architecture/boundary-imports.test.ts` fails on a new
  violation: `domain/` imports neither `app`, `app-shell`, nor `services`;
  `infra/` and `services/` import neither `app` nor `app-shell`; `app-shell`
  imports no provider or player runtime; nothing outside the shell imports
  `ink`; no active code imports `.archive/legacy` or `.reference/experiments`. Details
  in [.docs/runtime-boundary-map.md](.docs/runtime-boundary-map.md).
- **`apps/cli/src/main.ts` is the only entrypoint.** Do not add a second one.
- **Production providers are the ones in
  `apps/cli/src/container/bootstrap-providers.ts` →
  `loadProductionProviderModules()`.** A module existing under
  `packages/providers/src/` does not make it live.
- **Episode numbers are 1-based in the UI.** Providers adapt internally.
- **`isAnimeProvider: true` is what puts a provider in anime mode.**
- **`packages/providers/src/allmanga/api-client.ts` carries ani-cli parity
  logic.** Check parity against the reference implementation before changing
  crypto or decoder constants, and document any deliberate divergence in
  [.docs/providers.md](.docs/providers.md).
- **Relay is metadata-only by default.** Do not route video through it unless
  `videoFallback` is explicitly enabled and the host is in
  `relayProfile.videoRelayHosts`. `packages/relay` is the single shared
  implementation; `apps/relay-server` stays a thin adapter.
- **Kunai must never ship a shared public relay URL.** `providerRelay.baseUrl`
  is empty by default and user-owned.
- **Telemetry is opt-in and payload-bounded.** See
  [.docs/telemetry-privacy-contract.md](.docs/telemetry-privacy-contract.md)
  before touching `services/telemetry` or `apps/telemetry-ingest`.

## Commands

```sh
bun run dev                       # interactive shell
bun run dev -- -S "Dune"          # search on launch
bun run dev -- -i 438631 -t movie # jump to a TMDB id
bun run dev -- -a                 # anime mode
bun run dev -- --debug            # verbose redacted logging to ./logs.txt
bun run dev:relay                 # local relay server
bun run link:global               # install `kunai` from this checkout
```

Before finishing work:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run verify:doc-paths   # if you touched AGENTS.md or .docs/
```

- `bun run test` for tests — never `bun test` directly.
- `bun run build` after a complete feature or before release, to catch
  build-only errors.
- Tests live in `apps/cli/test/unit/`, `apps/cli/test/integration/`, and
  `apps/cli/test/live/`. Relay smoke is opt-in — run `bun run dev:relay`, set
  `KUNAI_RELAY_BASE_URL=http://127.0.0.1:8787`, then
  `bun run test:live:relay-allanime`.

## Priorities

- **Correctness over convenience.** When a tradeoff is forced, choose the
  behavior that stays predictable during failure, recovery, and provider churn.
- **Diagnosable failures.** Log enough context to reason about a failure after
  the fact. Never leave the terminal in a broken state.
- **Silent no-ops are the house failure mode** — flags parsed and dropped,
  settings persisted and ignored, capabilities declared and unread. If you add a
  declaration, add its reader;
  `apps/cli/test/unit/architecture/contract-conformance.test.ts` gates this.
- **Extract shared logic instead of patching locally.** Duplicated logic across
  files is a design smell. Reshaping existing code to improve the long-term
  design is welcome; mass-renaming for style is not.

## Bun-first runtime

- Prefer `Bun.spawn`, `Bun.which`, `Bun.connect` (Unix sockets), and `Bun.sleep`
  for deliberate delays on Bun-only paths.
- Prefer `Bun.file` / `Bun.write`, or `writeAtomicJson` in
  [`apps/cli/src/infra/fs/atomic-write.ts`](apps/cli/src/infra/fs/atomic-write.ts),
  for whole-file JSON without append semantics or special permission flags.
- Prefer Node `fs` for append (`appendFile`), crash-safe atomic replace (temp
  file in the target directory + `rename`), `copyFile` with mtime checks, sync
  `mkdir` next to SQLite bootstrap, and tight `existsSync` / `unlink` sequences
  on mpv socket paths.
- Prefer `setTimeout` for cancellable deadlines (mpv IPC per-command timeouts
  with `clearTimeout`).
- Prefer `node:crypto` synchronous hashing for small hot-path keys.
- Do not change APIs for style alone; keep Node where cross-platform semantics
  are clearer.

## Deep docs

Read one when your change lands in its subject. Not before.

| Changing…                                                                     | Read                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where feature X lives                                                         | [.docs/feature-map.md](.docs/feature-map.md)                                                                                                                           |
| Playback flow, provider orchestration, persistence, recovery                  | [.docs/architecture.md](.docs/architecture.md)                                                                                                                         |
| Which layer or package work belongs in                                        | [.docs/runtime-boundary-map.md](.docs/runtime-boundary-map.md)                                                                                                         |
| Broad refactors, service extraction, caching                                  | [.docs/engineering-guide.md](.docs/engineering-guide.md)                                                                                                               |
| Shell flow, hotkeys, overlays, setup UX                                       | [.docs/ux-architecture.md](.docs/ux-architecture.md) · [.docs/keybindings.md](.docs/keybindings.md)                                                                    |
| Terminal styling and interaction patterns                                     | [.docs/design-system.md](.docs/design-system.md) · [.docs/ui-redesign-playbook.md](.docs/ui-redesign-playbook.md)                                                      |
| Poster previews, native Kitty/iTerm2/Sixel output, image capability detection | [.docs/poster-image-rendering.md](.docs/poster-image-rendering.md)                                                                                                     |
| Adding or hardening a provider                                                | [.docs/providers.md](.docs/providers.md) · [.docs/provider-intake.md](.docs/provider-intake.md) · [.docs/provider-agent-workflow.md](.docs/provider-agent-workflow.md) |
| A provider shape from scratch                                                 | [.docs/provider-examples.md](.docs/provider-examples.md)                                                                                                               |
| Source, quality, audio, subtitle inventory                                    | [.docs/playback-source-inventory-contract.md](.docs/playback-source-inventory-contract.md)                                                                             |
| IntroDB/AniSkip, MAL resolution, auto-skip metadata                           | [.docs/playback-timing-and-aniskip.md](.docs/playback-timing-and-aniskip.md)                                                                                           |
| mpv reconnect on the persistent session path                                  | [.docs/mpv-in-process-reconnect.md](.docs/mpv-in-process-reconnect.md)                                                                                                 |
| Debug logs, diagnostics panels, provider tracing                              | [.docs/diagnostics-guide.md](.docs/diagnostics-guide.md)                                                                                                               |
| Broad reliability or debugging sweeps                                         | [.docs/debugging-map.md](.docs/debugging-map.md)                                                                                                                       |
| Provider health, cache layers, reset behavior                                 | [.docs/title-provider-health-and-cache-reset.md](.docs/title-provider-health-and-cache-reset.md)                                                                       |
| `/discover` and recommendations                                               | [.docs/recommendations-and-discover.md](.docs/recommendations-and-discover.md)                                                                                         |
| Share URLs, `/share`, `/watch`, `kunai --open`                                | [.docs/share-links.md](.docs/share-links.md)                                                                                                                           |
| Discord presence and social status                                            | [.docs/presence-integrations.md](.docs/presence-integrations.md)                                                                                                       |
| Download, offline library, setup, onboarding                                  | [.docs/download-offline-onboarding.md](.docs/download-offline-onboarding.md)                                                                                           |
| AniList/TMDB sync, the outbox, tracker auth                                   | [.docs/tracker-sync.md](.docs/tracker-sync.md)                                                                                                                         |
| Tests, test seams, new runtime behaviors                                      | [.docs/testing-strategy.md](.docs/testing-strategy.md)                                                                                                                 |
| CI, Husky, lint-staged, issue and PR templates                                | [.docs/repo-infrastructure.md](.docs/repo-infrastructure.md) · [.docs/lint-policy.md](.docs/lint-policy.md)                                                            |
| Release gating                                                                | [.docs/release-reliability-gate.md](.docs/release-reliability-gate.md)                                                                                                 |
| Setup, local run flow, troubleshooting                                        | [.docs/quickstart.md](.docs/quickstart.md)                                                                                                                             |
| Product vocabulary (Watchlist / Playlists / Up Next / …)                      | [.docs/adr/0001-personal-media-vocabulary.md](.docs/adr/0001-personal-media-vocabulary.md)                                                                             |
| Parked surfaces — web, desktop, daemon, cache direction                       | [.docs/architecture-v2.md](.docs/architecture-v2.md)                                                                                                                   |
| Local UI prototype harnesses                                                  | [.docs/prototypes.md](.docs/prototypes.md)                                                                                                                             |

Per-feature product rules live in [.docs/features/](.docs/features/). Provider
research dossiers live in [.docs/provider-dossiers/](.docs/provider-dossiers/).

## Where things are written down

One meaning per directory. If two places could hold a file, it belongs in the
more specific one.

| Folder          | Holds                                                                                             | Authority                      |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| `.docs/`        | How the system works and why; vocabulary in [.docs/glossary.md](.docs/glossary.md)                | Current, unless code disagrees |
| `.plans/`       | Unfinished work only — the **only** plan board, indexed by [.plans/roadmap.md](.plans/roadmap.md) | Intent, not behavior           |
| `.reference/`   | Live material never imported by runtime: design authority, provider research lab                  | Reference                      |
| `.archive/`     | Everything superseded — docs, plans, the closed SDD wave, dead modules                            | **None** — history only        |
| `docs/`         | The public docs site (`apps/docs`); provider, command, and flag tables generated from source      | Current, user-facing           |
| `.docs/agents/` | Issue tracker, triage labels, domain-doc conventions                                              | Current                        |

Never cite a file under `.archive/` as authority for current behavior. See
[.archive/README.md](.archive/README.md) and
[.reference/README.md](.reference/README.md).

## Keeping docs honest

The dominant cause of doc rot here is a directory reorganization that leaves
routing docs pointing at the old layout — silent until an agent looks in the
wrong place. `bun run verify:doc-paths` turns that into a failure: it checks
every backticked repo path and relative link in `AGENTS.md`, `.docs/`, and
`.docs/agents/`.

When you finish work:

- Update the doc that owns the subject, in the same change set.
- If a plan's core landed, move it to `.archive/plans/` and leave one roadmap
  row for the residue. Do not leave a landed plan sitting in `.plans/`.
- Cite a file that no longer exists only with wording that says so ("the old
  `x.ts` was removed") — the verifier keys off that.

## User data

Paths are platform-resolved by `getKunaiPaths()` in
`packages/storage/src/paths.ts` — Linux `~/.config/kunai`, macOS
`~/Library/Application Support/kunai`, Windows `%APPDATA%\kunai`. Do not
hardcode `~/.config`.

| Data               | Location                           |
| ------------------ | ---------------------------------- |
| Config             | `configDir/config.json`            |
| Provider overrides | `configDir/providers.json`         |
| mpv bridge script  | `configDir/mpv/kunai-bridge.lua`   |
| Data DB            | OS data dir, `kunai-data.sqlite`   |
| Cache DB           | OS cache dir, `kunai-cache.sqlite` |
| Debug log          | `./logs.txt`, only under `--debug` |

SQLite owns history and cache. The JSON config and provider-override stores are
current; JSON history and cache stores are legacy implementation details.

## Agent conventions

- **Issues** — GitHub Issues on `KitsuneKode/kunai`. Workflow in
  [.docs/agents/issue-tracker.md](.docs/agents/issue-tracker.md); label vocabulary
  in [.docs/agents/triage-labels.md](.docs/agents/triage-labels.md).
- **Domain language** — [.docs/agents/domain.md](.docs/agents/domain.md). Kunai is
  single-context: one system-wide ADR set in `.docs/adr/`, no per-package
  context files. New ADRs get the next sequential number.
