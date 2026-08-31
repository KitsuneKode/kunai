---
status: current
lastReviewed: "2026-09-01"
---

# Kunai Runtime Boundary Map

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this doc when deciding where new runtime, provider, playback, shell, cache,
diagnostics, or legacy-removal work belongs. It is intentionally short and
points at deeper docs instead of replacing them.

## Rule Of Thumb

UI emits intent.
App policy turns intent into deterministic behavior.
Services coordinate work.
Providers return facts and candidates.
Infra performs local mechanics.
Storage persists facts.

If a module does more than one of those jobs, either extract a seam or document
why the overlap is temporary.

## Enforced Layering

These are not conventions — `apps/cli/test/unit/architecture/boundary-imports.test.ts`
fails the build on a new violation. Existing violations are baselined in that
file with dated `DEBT` entries; adding to a baseline needs a reason in the diff.

| Layer                    | Must not import                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `apps/cli/src/domain`    | `@/app`, `@/app-shell`, `@/services`                                                                  |
| `apps/cli/src/infra`     | `@/app`, `@/app-shell`                                                                                |
| `apps/cli/src/services`  | `@/app`, `@/app-shell`                                                                                |
| `apps/cli/src/app-shell` | providers (`@kunai/providers`, `@/services/providers`) and player runtime (`@/infra/player`, `@/mpv`) |
| Any non-shell layer      | `ink` directly                                                                                        |
| Any active runtime root  | `.archive/legacy`, `.reference/experiments`                                                           |

The same test also gates workspace dependencies per package, so a new
`packages/*` dependency edge needs an allowlist entry.

## Ownership

| Area                           | Owns                                                                                                              | Must not own                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `packages/types`               | Serializable contracts crossing package, storage, and provider boundaries                                         | UI state, app policy, provider quirks       |
| `packages/schemas`             | Runtime validation for untrusted or persisted data                                                                | Business decisions                          |
| `packages/core`                | Provider SDK contracts, resolver primitives, cache-key policy, fallback abstractions, trace models                | Ink UI, mpv IPC, history writes             |
| `packages/providers`           | Provider-specific source extraction, mirror/source retry, decryption, language/source evidence                    | Global fallback UX, history, app settings   |
| `packages/relay`               | Provider RPC relay validation, host allowlists, client fetch-port adapter, relay server shared handler            | Provider scraping logic, app settings UI    |
| `packages/storage`             | SQLite paths, migrations, repositories, TTL helpers                                                               | UI behavior, provider scraping              |
| `apps/cli/src/services`        | App services such as playback resolve, source inventory, diagnostics, presence, search/catalog orchestration      | Ink rendering, raw mpv sockets              |
| `apps/cli/src/app`             | Session phases, playback/search policy, user-intent semantics, history decisions, queue claim/ack/rollback policy | Provider internals, terminal drawing        |
| `apps/cli/src/domain/queue`    | Queue playback intents, restore-with-resume, planner placement, `QueueService` adapters over storage              | Ink rendering, mpv launch, provider resolve |
| `apps/cli/src/infra`           | mpv/IPC and Android intent mechanics; only observed players emit `playback-started`                               | User-facing playback or queue policy        |
| `apps/cli/src/app-shell`       | Ink components, overlays, footer, command palette, picker rendering; exact-ID queue play bridge                   | Stream resolution, provider fallback policy |
| `apps/mobile/src/application`  | Portable mobile host-proof policy behind HTTP, state, terminal, and player ports                                  | Bun, a-Shell, Ink, provider implementations |
| `apps/mobile/src/runtime`      | Android/Bun and a-Shell/JavaScriptCore host adapters selected at build time                                       | Portable workflow policy, desktop CLI code  |
| `.archive/legacy/apps/cli/src` | Quarantined old runtime/provider/browser reference code                                                           | Active beta runtime imports                 |
| `.reference/experiments`       | Provider research and scratchpads                                                                                 | Production runtime behavior                 |

## Naming And Placement Rules

The current names are a mix of newer boundaries and migration-era files. Use
these meanings for new work and for cleanup when touching an area:

| Name pattern      | Meaning                                                             | Belongs in                                       |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| `*-view.ts`       | Pure presentation model builder, no Ink and no I/O                  | `app-shell` or `domain`                          |
| `*-shell.tsx`     | Ink render surface and input handling for one screen                | `app-shell`                                      |
| `*-workflows.ts`  | Shell-owned picker/overlay flows that collect user intent           | `app-shell`, split by feature family             |
| `*-routing.ts`    | Pure mapping from user/shell action to app-level route/result       | `app` or `domain` if fully pure                  |
| `*-policy.ts`     | Deterministic rule that returns decisions/effects, not side effects | `domain` for pure rules, `app` for session rules |
| `*-service.ts`    | I/O orchestration behind a stable contract                          | `services`                                       |
| `*-repository.ts` | Storage read/write abstraction                                      | `packages/storage`                               |
| `*-adapter.ts`    | Boundary translation between two models/contracts                   | closest owner of the consuming boundary          |
| `*-lifecycle.ts`  | Start/stop/cleanup ordering for a runtime resource                  | `app` for policy, `infra` for mechanics          |
| `*-input.ts`      | Data shape builder for another model or subsystem                   | nearest caller boundary                          |

Avoid using `manager`, `controller`, or `helper` for new files unless the file
really coordinates stateful ownership. Prefer a name that says what decision or
surface it owns.

### Filename casing (locked)

- **`.ts` logic modules:** kebab-case filenames (`playback-resolve-policy.ts`,
  `download-service.ts`). Class export names stay PascalCase
  (`export class DownloadService`).
- **`.tsx` Ink components:** PascalCase (`ListRow.tsx`) or the shell suffixes
  `*-shell.tsx` / `*-ui.tsx`.
- **`.model.ts` companions:** PascalCase prefix matching the component
  (`ListRow.model.ts`).
- Existing PascalCase `.ts` service/phase files are migration debt. Rename them
  only under the rename policy below; new `.ts` files must be kebab-case.

### Current confusing names

- `app-shell/workflows/` is a migration bucket split by feature family. New
  shell flows join an existing family file rather than growing a shared one.
- `app-shell/ink-shell.tsx` is still both host and surface code. New render
  extraction should move one surface or presenter at a time; do not add more
  policy there.
- `app/playback/PlaybackPhase.ts` is still the playback state machine plus too
  much surrounding orchestration. Extract only tested transition slices from it.
- `domain/types.ts` is a CLI-domain type bridge, not the package contract. Do
  not move it into `packages/types` until adapter tests cover the conversion.

### Rename policy

Do not mass-rename for style. Rename or move a file only when:

1. The destination boundary is clear.
2. Tests cover the old behavior.
3. Imports can be updated mechanically.
4. The commit does not also change unrelated behavior.

## Playback Intent Contract

Playback actions should be named intents before they touch mpv:

- history resume: start at the saved timestamp
- history restart, picker selection, replay, next, previous, and source change:
  start at zero and expose the mpv resume prompt only when a real resumable
  timestamp exists
- reload video and quality change: continue from the current playback point

Do not let raw `--start` values leak through picker components or provider
adapters. The app layer owns the meaning, and the infra/player layer owns the
mechanism.

Player variation stays behind `PlayerService`: domain owns immutable capability
facts and stream qualification, app owns observed-versus-detached policy, infra
owns mpv or Android launch mechanics, and app-shell renders the resulting state.
An intent-launch exit code is launch acceptance only; infra must not synthesize
progress, completion, EOF, provider health, or queue acknowledgement.

## Mobile application ownership

`apps/mobile` is a separate deep application module with one entrypoint and no
cross-app imports. Its application directory owns runtime-neutral policy. Its
runtime directory owns two build-selected compositions: Bun/Bionic for Termux
and conservative JavaScript plus fixed helpers for a-Shell mini. The iOS graph
must not contain Node, Bun, native, SQLite, Ink, or React runtime dependencies.

The current slice is a host proof, not desktop feature parity: it exercises
terminal input, bounded HTTP, atomic state, and detached VLC handoff using
tester-owned URLs. Search, catalog, provider resolution, progress, analytics,
installers, and release support are not implied. Qualification and physical
procedures live in [mobile-terminal-runtime.md](./mobile-terminal-runtime.md).

## Command Ownership

Command labels, availability, disabled reasons, and per-surface command sets
belong to `apps/cli/src/domain/session/command-registry.ts`.

UI surfaces should consume named command contexts rather than rebuilding command
lists locally. This keeps `/`, footer hints, help, overlays, and playback
controls aligned.

## Picker Ownership

Opening a picker is never a side effectful media action.

- open picker: inspect choices only
- move/filter picker: UI state only
- confirm picker: emits a selected value
- app/player control layer: decides whether playback must stop/reload/switch

This applies to episode, provider, source, quality, audio, and subtitle pickers.

## Provider Recovery Ownership

Provider-local recovery belongs inside the provider package or CLI provider
adapter:

1. Retry provider-local source/mirror work with bounded attempts.
2. Return structured failure evidence.
3. Let the app-level fallback controller decide when to try another provider.

The fallback controller should prefer cached healthy inventory when possible and
should expose provider/source exhaustion in diagnostics.

## Provider Relay Ownership

Provider geo-relay is a transport seam, not a provider runtime:

- `packages/relay` owns request validation, header filtering, redirect checks,
  request/response limits, registry building from manifests, and the
  `ProviderFetchPort` implementation.
- `packages/providers` owns provider-specific URLs and calls `providerFetch`
  instead of raw `fetch` for relay-eligible metadata work.
- `packages/core` injects provider-aware runtime context into resolve/search/list
  calls.
- `apps/cli` owns user config (`providerRelay`) and settings/env wiring.
- `apps/relay-server` is only a deployable HTTP adapter over `@kunai/relay`.

Do not add a generic `?url=` proxy or per-provider relay server routes.

## Legacy Quarantine

Active runtime code must not import `.archive/legacy`, `.reference/experiments`, or other reference-only legacy paths.
The unit boundary test enforces this for active runtime roots.

When removing legacy:

1. Prove the active path has equivalent behavior or a deliberate product
   decision.
2. Add or keep a test around the active path.
3. Move remaining reference code under `legacy` only if it still teaches us
   something.
4. Delete it when it no longer informs provider parity or migration.

## Queue acknowledgement ownership

- **Storage** owns compare-and-set transitions (`markInFlight`,
  `acknowledgePlaybackStarted`, `restoreInFlightToPending`) and crash restore
  placement. It must not import CLI domain types.
- **Domain (`QueueService` / restore)** owns exact-ID claim intents and
  recoverable-session restore order (in-flight identity first).
- **App (PlaybackPhase / `createQueuePlaybackAttempt`)** owns when to claim,
  acknowledge (only on `playback-started`), and rollback before start.
- **Infra (player)** emits lifecycle events; it must not mark queue rows played.
- **App-shell** may claim via `beginPlayback(exactId)` for manual / post-play
  play actions, then hand the intent to app playback — never mark played itself.

## Related Docs

- Runtime architecture (what exists): [architecture.md](./architecture.md)
- Direction (parked surfaces): [architecture-v2.md](./architecture-v2.md)
- Engineering guide: [engineering-guide.md](./engineering-guide.md)
- Shell and overlay UX: [ux-architecture.md](./ux-architecture.md)
- Provider contracts: [providers.md](./providers.md)
- Source inventory contract: [playback-source-inventory-contract.md](./playback-source-inventory-contract.md)
- Testing strategy: [testing-strategy.md](./testing-strategy.md)
- Up Next product rules: [features/queue.md](./features/queue.md)
