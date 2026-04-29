# Kunai Target Runtime Architecture

Use this doc when changing the target runtime shape, monorepo boundaries, package contracts, local daemon, cache architecture, or future web/desktop integration.

This is the target architecture companion to [.docs/architecture.md](./architecture.md), which describes the current CLI runtime.

## Target Shape

Kunai should become a local-first media runtime with three product surfaces:

- CLI: flagship runtime, fastest iteration loop, primary reliability proving ground.
- Web: low-friction mainstream surface, static-first, browser-safe by default.
- Desktop: bundled local compute and polished wrapper after daemon contracts stabilize.

These surfaces should share contracts and provider intelligence, but they should not share UI code by accident.

```text
apps/cli        -> Ink shell, mpv handoff, local-first runtime, optional account sync
apps/web        -> Next.js app, browser cache, player UI, pairing client, low-cost signed-in surface
apps/desktop    -> later wrapper around web UI plus bundled daemon
packages/*      -> contracts, schemas, cache, provider core, CLI UI primitives
```

## Runtime Principles

- The CLI remains the first-class product until playback reliability, cache correctness, and diagnostics are excellent.
- Web must work without local pairing for browser-safe paths, but pairing unlocks heavy providers and local playback intelligence.
- Sign-in should improve continuity, sync, budgets, and personalization; it must not be required for local CLI playback.
- Cloud compute is a paid convenience layer, not the default product path.
- Provider behavior must be capability-driven, not hardcoded into UI surfaces.
- Every resolution should produce a `ResolveTrace`.
- Cache policy should be explicit per data type and provider capability.
- Legacy code can remain as reference, but it must be quarantined away from production imports.

## Surface Capability Split

Kunai should share intelligence across surfaces, but each surface has a different job.

```text
CLI / local runtime
  - owns local-first power: Playwright leases, yt-dlp, mpv, local credentials, local stream cache
  - can offer optional sign-in for sync, device list, encrypted backup, and account status
  - should remain fully useful offline or signed out for local playback paths

Web unpaired
  - owns reach: static shell, fast browse, PWA, IndexedDB, browser-safe providers, narrow relay
  - must be independently useful without CLI/Desktop running
  - should minimize Kunai-side compute with static rendering, client cache, edge metadata, and strict budgets
  - should degrade gracefully into "pair local compute" or "cloud convenience available" states

Web paired
  - uses local daemon for heavy providers, local credentials, stronger auto-heal, and optional player handoff
  - never commands localhost without explicit pairing, scoped tokens, and visible connected-device state

Signed-in sync
  - owns continuity: history events, preferences, device list, theme/profile state, cloud budgets
  - should sync durable user intent, not raw playable links or provider secrets

Paid cloud convenience
  - owns rare fallback convenience for mobile/TV users when local compute is unavailable
  - must be entitlement-gated, budgeted, queued, observable, and optional
```

Rule of thumb: if a feature needs private credentials, raw playable URLs, browser automation, `mpv`, or heavy probing, it belongs in CLI/Desktop/local daemon first. If a feature needs discovery, onboarding, browse, player polish, lightweight source confidence, or sync visibility, it belongs in web. The unpaired web path should stand on its own; pairing should make it stronger, not make it valid.

## Package Boundaries

Target package split:

```text
packages/types
  Future package name: `@kunai/types`.
  Pure TypeScript contracts and shared enums.

packages/schemas
  Future package name: `@kunai/schemas`.
  Zod schemas for config, cache rows, IPC payloads, relay payloads, sync events, and imported mapping data.

packages/core
  Future package name: `@kunai/core`.
  Provider contracts, capability manifests, runtime ports, cache-key policy, resolver orchestration, source ranking, and resolve tracing.

packages/cache
  Future package name: `@kunai/cache`.
  OS path resolution, JSON compatibility stores, SQLite repositories, TTL classes, pruning, and migrations.

packages/config
  Future package name: `@kunai/config`.
  User config defaults, validation, migration from old paths, and typed config helpers.

packages/ui-cli
  Future package name: `@kunai/ui-cli`.
  Ink primitives, theme tokens, command surfaces, badges, panels, and reusable TUI components.

packages/legacy
  Reference-only legacy runtime and provider code during migration. Nothing production imports from here.
```

## Trust Boundaries

Use TypeScript for internal compile-time contracts. Use Zod at trust and serialization boundaries:

- config reads
- cache database rows
- daemon IPC payloads
- web relay requests and responses
- provider HTTP responses
- imported mapping databases
- sync events
- future local plugin manifests

Do not Zod-parse every internal object in hot paths. Validate at the edge, then pass typed values through the system.

## Storage Direction

Short term:

- Keep config and history JSON if single-process.
- Move stream cache to OS cache paths.
- Preserve repo-local `stream_cache.json` as legacy read-only compatibility during migration.

Daemon/web era:

- Use SQLite for stream cache, provider health, source inventory, resolve traces, and sync event logs.
- Keep durable user state separate from disposable cache state.
- Use WAL mode and repository classes, not a heavy ORM by default.

Canonical split:

```text
kunai-data.sqlite   -> durable user data and sync event log
kunai-cache.sqlite  -> disposable stream/source/provider/trace cache
```

## Web Direction

The web app should not depend on a local machine to be useful.

Unpaired web paths:

- static browse and metadata
- IndexedDB cache
- browser-safe provider modules
- narrow provider RPC relay for CORS-limited but cheap providers
- signed-in sync/home surfaces when available
- clear source confidence, disabled reasons, and upgrade/pairing prompts

Paired web paths:

- local daemon resolution
- Playwright-backed providers
- mpv or desktop player handoff
- local credentials such as Debrid
- stronger local auto-heal and provider fallback
- local cache/source inventory reuse

Paid paths:

- sync
- higher relay budget
- limited cloud resolver convenience
- TV/mobile convenience when local compute is unavailable

Signed-in web should be better, not mandatory:

- synced continue watching
- synced settings and profiles
- provider-health intelligence
- device pairing history
- premium budget dashboard
- optional cloud convenience

Signed-in web must not store:

- raw playable links from untrusted clients
- provider cookies
- local daemon tokens
- debrid-derived playback links
- user-specific stream headers

## Daemon Direction

The daemon must be explicit and scoped:

- loopback by default
- random high port
- one-time pairing code or QR
- origin allowlist
- short-lived scoped tokens
- visible connected-device state
- revocation
- no arbitrary fetch endpoint

## Execution Order

1. Finish current CLI stability work.
2. Move repo to the minimal Turborepo shape without changing behavior.
3. Establish the true root shell in `apps/cli` so browse, picker, loading, playback, overlays, and post-playback are content states inside one mounted app.
4. Complete Phase 1.8 so browse, loading, playback, and post-playback share one mounted content tree instead of helper-shell sessions.
5. Extract shared contracts before extracting provider implementations.
6. Move storage path and cache policy into shared packages.
7. Extract one 0-RAM provider into `@kunai/core`.
8. Add `ResolveTrace` and provider health as first-class outputs.
9. Build daemon pairing only after cache and provider contracts are stable.
10. Start web as static-first and capability-aware, not compute-first.

Phase 2 completion means shared contracts compile, schemas validate serialized forms, root verification includes the shared packages, and the CLI emits one typed `ResolveTrace` stub for diagnostics. It does not mean providers have moved into `@kunai/core`.

## Non-Goals For This Phase

- No full desktop app before daemon protocol stabilizes.
- No generic public plugin execution in the browser.
- No generic CORS proxy.
- No central stream cache from untrusted clients.
- No paid cloud Playwright before entitlement, quotas, and concurrency caps exist.
