---
status: current
lastReviewed: "2026-10-13"
---

# ADR 0007 — Pluggable Provider System

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- Status: accepted (prototype-gated — see Consequences)
- Date: 2026-10-13
- Context: provider intake, lane strategy, FMHY round 2
  (`.docs/provider-dossiers/fmhy-round2-blocked.md`)

## Decision

Provider modules become loadable plugins behind the interface that already
exists (`ProviderModule` in `packages/types/src/index.ts`,
`CoreProviderModule` + manifest in `packages/core/src/provider-sdk.ts`).
Third-party providers load from a user-owned directory, run with the same
`ProviderRuntimeContext` ports (and nothing else), and pass the same gates as
bundled providers. Bundled providers migrate onto the same loader.

## Why

- Provider work and client work have different cadences and different authors.
  Today every lane fix is a core-repo change; the maintainer is the bottleneck
  for all twelve lanes plus every candidate.
- The failure data says breadth beats depth right now: four FMHY candidates
  blocked upstream in one round, while healthy lanes need parity work. A
  plugin index lets independent authors carry lanes without core review of
  every scraper line.
- The trust machinery already exists and is proven: resolve-gate coverage,
  contract conformance, relay host allowlists, per-provider toggles,
  quarantine canary. Plugins inherit all of it instead of inventing new
  safety.

## Contract (what "a plugin" means)

1. **Unit**: a directory with `kunai-plugin.json`
   (`id`, `pluginVersion`, `engineCompat`, `author`, `entry`,
   `permissions.hosts`, `signature`) plus the module entry exporting a
   `CoreProviderModule`.
2. **Runtime**: the module receives `ProviderRuntimeContext` ports only — no
   `process.env`, no fs, no Bun APIs, no `@/app*` imports. Fetch is gated by
   `permissions.hosts`; undeclared hosts are blocked and reported.
3. **Gates** (same as bundled, no exceptions): manifest schema validation,
   `verifyCandidateStream` resolve gate, capability honesty (declared caps
   exercised by fixtures), forbidden-import boundary test, live smoke on
   pinned titles.
4. **Versioning**: `engineCompat` semver against the engine's
   `engineApiVersion`. Mismatch refuses with upgrade guidance. Updates
   re-validate and re-run the contract suite before swapping.
5. **Control**: signed blocklist (id + version range + reason) disables into
   the existing toggles UI. No silent behavior anywhere.

## Non-goals

- Browser-automation plugins (extends ADR 0002's browserless strategy into
  store policy).
- Paid/DRM/key-escrow plugins in the default index; third-party indexes
  allowed, never default.
- Subprocess/worker isolation in v1 — explicit-install trust, same as
  `install.sh`. Revisit when a plugin earns distrust, not before.

## Consequences (prototype-gated)

- **Must prove first**: compiled-binary dynamic import of external plugin
  files (`bun build --compile` + runtime `import()`). If it fails, the design
  falls back to sidecar-source plugins in dev, bundled in release.
- Bundled providers migrate onto the loader (dogfood); the default set and
  ordering semantics do not change.
- New guardrails land with the loader, not after: manifest schema check,
  boundary test extension, contract-test kit extraction, blocklist plumbing.
- Build order: RFC (this ADR + plan) → loader prototype → `provider check`
  kit → URL install MVP → registry index + hub browse + blocklist.

## Related

- Plan: `.plans/plugin-provider-system.md`
- Template: `packages/providers/src/_template.ts`
- Intake: `.docs/provider-intake.md`
