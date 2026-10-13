---
status: current
lastReviewed: "2026-10-13T06:43:52Z"
---

# ADR 0007 — Pluggable Provider System

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- Status: proposed (prototype and trust-model gates remain)
- Date: 2026-10-13
- Context: provider intake, lane strategy, FMHY round 2
  (`.docs/provider-dossiers/fmhy-round2-blocked.md`)

## Decision

Provider modules become loadable plugins behind the interface that already
exists (`ProviderModule` in `packages/types/src/index.ts`,
`CoreProviderModule` + manifest in `packages/core/src/provider-sdk.ts`).
The first loader handles reviewed bundled providers through
`ProviderRuntimeContext` ports. Third-party installation remains gated on an
explicit trust model and execution protocol. An in-process JavaScript module
has Bun/Node globals and the application's OS permissions: passing ports and
banning imports does not remove that access. Bundled providers may dogfood the
loader after existing release targets and offline behavior are qualified.

## Why

- Provider work and client work have different cadences and different authors.
  Today every lane fix is a core-repo change; the maintainer is the bottleneck
  for all twelve lanes plus every candidate.
- The failure data says breadth beats depth right now: four FMHY candidates
  blocked upstream in one round, while healthy lanes need parity work. A
  plugin index lets independent authors carry lanes without core review of
  every scraper line.
- Existing built-in safeguards include resolve-gate coverage, contract
  conformance, relay host allowlists and endpoint-health quarantine. Manual
  provider switches are a separate unmerged change; no automatic quarantine
  canary is wired in the current cycle. A plugin loader must explicitly integrate
  reviewed safeguards rather than claim that an imported module inherits them.

## Contract (what "a plugin" means)

1. **Unit**: a directory with `kunai-plugin.json`
   (`id`, `pluginVersion`, `engineCompat`, `author`, `entry`,
   `permissions.hosts`, `signature`) plus the module entry exporting a
   `CoreProviderModule`.
2. **Runtime**: reviewed modules use provider-scoped context ports; no
   `@/app*` imports or access to another provider's credentials. Import rules
   are conventions checked by the contract kit, not a security sandbox.
   The fetch port validates approved hosts, redirects and resolved addresses;
   a full-trust in-process module can bypass that port through globals.
   The UI and documentation must disclose that distinction. Third-party
   execution needs a constrained protocol and an enforceable isolation policy
   before it can claim host-only access.
3. **Gates**: manifest schema validation, capability fixtures, bounded
   cancellation/deadline behavior and live qualification through the production
   engine. A plugin's success claim is not proof of stream reachability. The
   host must enforce the resolve gate on the candidate it will publish;
   runtime exemptions require reviewed host policy, never a plugin-supplied
   assertion or an imported-but-unused marker. The kit itself executes code
   only after its trust decision.
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
- Automatic third-party installation or unattended plugin updates in v1.
  A worker or ordinary child process is crash isolation, not an OS security
  boundary; a constrained child still needs restricted credentials, bounded
  IPC and an enforceable filesystem/network policy.

## Identity, installation and recovery

- Discover under `getKunaiPaths().configDir`, not a Linux-only hardcoded path.
  Reject entry paths outside the canonical plugin directory, symlink escapes,
  duplicate ids and built-in provider replacement. Package id and module id
  must match. Installed is distinct from enabled.
- Bind compatibility to a defined, exported SDK API version. Test dependencies
  from a plugin outside the repo so workspace resolution cannot hide a missing
  public SDK. Mobile receives an explicit supported/unsupported result; neither
  entrypoint imports the other.
- Include plugin revision/digest in provider caches, health evidence and support
  bundles. Updates retire old resolve work and invalidate its inventory; rollback
  restores the last verified revision. Removing or disabling a plugin must not
  delete downloaded media or watched history.
- A checksum served beside an archive is not independent authentication.
  Signatures require an approved publisher key/index trust root and key-rotation
  policy. Permission or publisher changes need an explicit new decision.
- Installation validates bounded archive sizes/file counts, canonical paths,
  symlinks and platform names before extraction. Stage privately, verify, then
  atomically activate under ownership fencing; retain the previous revision on
  failure. Never execute install hooks or a plugin while merely inspecting it.
- A blocklist needs offline/stale/invalid-signature behavior. Show the reason
  and recovery action; do not silently re-enable a disabled provider or route
  through it when other providers are unavailable.

## Prototype evidence

A Linux x64 probe with Bun 1.4.2 successfully imported an external `.mjs` from a
compiled host. The same probe confirmed access to `globalThis.Bun.write` and
`globalThis.process.env` despite receiving only a fetch context. This qualifies
neither a sandbox nor Windows/macOS/mobile nor an external SDK dependency graph.
[Bun's executable documentation](https://bun.com/docs/bundler/executables)
explicitly retains Bun and Node runtime APIs in compiled executables.

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
