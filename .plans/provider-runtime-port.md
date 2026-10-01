# Provider runtime port — inject fetch / which / clock / env

Status: TODO — written for audit-4 follow-up.

## Why this matters

`packages/providers` reads process globals directly:

- `globalThis.fetch` and `Bun.which` — mutated by tests (10+ test files swap
  them under `try/finally`; one leaked stub poisons every provider test that
  runs later in the same `bun test` process — the audit-4 flake class),
- `process.env.PATH` — the curl-impersonate resolver caches the resolved
  binary path, so tests that change PATH must also know to reset that cache,
- `Date.now`/clocks — latency and staleness logic.

A `ProviderRuntime` port (`fetch`, `which`, `now`, `env`) passed through the
existing `ProviderRuntimeContext` seam (HiAnime already takes one —
`packages/providers/test/hianime.test.ts` builds `{ fetch: { runtime:
"direct-http", fetch: … } }` contexts) turns every one of those reads into an
injected dependency:

- tests construct an isolated runtime instead of mutating `globalThis` —
  leaks become structurally impossible;
- `apps/mobile` can supply its own fetch/process-shim — the runtime-port
  blocker called out by the mobile-terminal-runtime track;
- curl-impersonate resolution becomes an explicit `which`/`env` consumer with
  a per-runtime cache, not a module-global one.

## Scope sketch

1. Define `ProviderRuntime { fetch, which, now, env }` in `@kunai/core` or the
   providers package boundary (check `provider-result-contract.md` first —
   contract work lands before broad `@kunai/core` extraction).
2. Production wiring: `loadProductionProviderModules()` /
   bootstrap constructs the Bun-backed runtime once; providers receive it
   through the resolve context.
3. Migrate globals module by module: `curl-impersonate`, the direct-lane
   fetchers, `Bun.which` call sites, clock reads. The `_template` provider is
   the reference adapter — port it first.
4. Delete the test-global `afterEach` safety nets once nothing reads globals —
   keep one architecture test that greps `packages/providers/src` for
   `globalThis.fetch`/`Bun.which`/`process.env` outside the runtime adapter.

## Not in scope

- Provider semantic changes, crypto, or roster edits.
- Relay internals (`packages/relay` has its own transport seam).
