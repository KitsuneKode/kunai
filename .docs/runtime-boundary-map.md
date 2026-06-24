# Kunai Runtime Boundary Map

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

## Ownership

| Area                          | Owns                                                                                                         | Must not own                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `packages/types`              | Serializable contracts crossing package, storage, and provider boundaries                                    | UI state, app policy, provider quirks       |
| `packages/schemas`            | Runtime validation for untrusted or persisted data                                                           | Business decisions                          |
| `packages/core`               | Provider SDK contracts, resolver primitives, cache-key policy, fallback abstractions, trace models           | Ink UI, mpv IPC, history writes             |
| `packages/providers`          | Provider-specific source extraction, mirror/source retry, decryption, language/source evidence               | Global fallback UX, history, app settings   |
| `packages/relay`              | Provider RPC relay validation, host allowlists, client fetch-port adapter, relay server shared handler       | Provider scraping logic, app settings UI    |
| `packages/storage`            | SQLite paths, migrations, repositories, TTL helpers                                                          | UI behavior, provider scraping              |
| `apps/cli/src/services`       | App services such as playback resolve, source inventory, diagnostics, presence, search/catalog orchestration | Ink rendering, raw mpv sockets              |
| `apps/cli/src/app`            | Session phases, playback/search policy, user-intent semantics, history decisions                             | Provider internals, terminal drawing        |
| `apps/cli/src/infra`          | mpv, IPC, process, filesystem, terminal/runtime mechanics                                                    | User-facing playback policy                 |
| `apps/cli/src/app-shell`      | Ink components, overlays, footer, command palette, picker rendering                                          | Stream resolution, provider fallback policy |
| `archive/legacy/apps/cli/src` | Quarantined old runtime/provider/browser reference code                                                      | Active beta runtime imports                 |
| `apps/experiments`            | Provider research and scratchpads                                                                            | Production runtime behavior                 |

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

- `app-shell/workflows.ts` is a migration bucket. New shell flows should move
  into feature-family files such as `history-workflows.ts`,
  `picker-workflows.ts`, and `setup-workflows.ts`.
- `app-shell/ink-shell.tsx` is still both host and surface code. New render
  extraction should move one surface or presenter at a time; do not add more
  policy there.
- `app/PlaybackPhase.ts` is still the playback state machine plus too much
  surrounding orchestration. Extract only tested transition slices from it.
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

Active runtime code must not import `archive/legacy`, `apps/experiments`, or other reference-only legacy paths.
The unit boundary test enforces this for active runtime roots.

When removing legacy:

1. Prove the active path has equivalent behavior or a deliberate product
   decision.
2. Add or keep a test around the active path.
3. Move remaining reference code under `legacy` only if it still teaches us
   something.
4. Delete it when it no longer informs provider parity or migration.

## Related Docs

- Runtime architecture: [architecture.md](./architecture.md)
- Target architecture: [architecture-v2.md](./architecture-v2.md)
- Engineering guide: [engineering-guide.md](./engineering-guide.md)
- Shell and overlay UX: [ux-architecture.md](./ux-architecture.md)
- Provider contracts: [providers.md](./providers.md)
- Source inventory contract: [playback-source-inventory-contract.md](./playback-source-inventory-contract.md)
- Testing strategy: [testing-strategy.md](./testing-strategy.md)
