# Plugin Provider System — Build Plan

Tracks ADR [0007](../.docs/adr/0007-pluggable-provider-system.md). Phases run
in order; each phase's guardrails land WITH the phase, never after.

## Phase 0 — Evidence gate (first, half a day)

Prove compiled-binary dynamic import: `bun build --compile` a hello target
that runtime-`import()`s an external plugin-shaped file. If it fails, the
design falls back to sidecar-source plugins in dev, bundled in release, and
the ADR is amended before any loader code.

- Guardrail: a test that fails when the fallback is needed but unrecorded.

## Phase 1 — Loader prototype

- Use `getKunaiPaths().configDir` for provider packages on every supported OS.
  Load only reviewed bundled packages in this first phase. Read `kunai-plugin.json`,
  validate the manifest against `@kunai/schemas`, check `engineCompat`,
  canonicalize the entry, reject escapes/duplicate ids/built-in replacement,
  then register into engine + registry + ordering + toggles. Installation does
  not enable a package. Load failures quarantine with a visible recovery action.
  An in-process module is full-trust code; import lint and host ports are not
  sandbox enforcement.
- Migrate ONE bundled provider (movy: smallest surface, best fixtures)
  onto the loader while still shipping it bundled.
- Guardrails: manifest/module identity parity, provider-scoped secrets,
  no `@/app*` imports, host-enforced resolve gates, duplicate/escape rejection,
  deadline/cancellation and quarantine tests. Qualify external dependencies
  outside the workspace and every release runtime before moving bundled modules.

## Phase 2 — `provider check` kit

Extract from existing tests into a runnable kit: manifest validation, gate
coverage (must probe via `verifyCandidateStream`), capability honesty,
forbidden imports, live smoke on pinned titles. `kunai provider check <dir>`
runs it. `kunai provider init <id>` scaffolds from `_template.ts` plus a
prefilled dossier.

- Guardrail: the kit must pass the migrated movy plugin and fail a
  deliberately-broken fixture plugin.

## Phase 3 — Trust and execution gate, then URL install (no registry yet)

Before accepting third-party code, choose and prove either an enforceable
isolated protocol or an explicitly full-trust developer-only mode. A plain
worker/subprocess is insufficient to claim restricted filesystem/network access.
The checker must not execute unapproved code during manifest inspection.

`kunai plugin install <url>`, `remove`, `info`: bounded download and archive
inspection, verify against an approved signing identity, validate compatibility,
then execute checks only under the selected trust policy. Stage privately and
activate atomically with an ownership fence and last-known-good rollback.
Updates retire old work and namespace caches by revision; permission/publisher
changes require a new decision. Removal retains media and personal history.

- Guardrails: signature/checksum mismatch, traversal/symlink/oversize archives,
  simultaneous installs and interrupted activation refuse safely. Show publisher,
  revision and whether declared hosts are enforced or advisory. No install hooks.
  Downgrades and permission expansion are explicit; disable/quarantine remains
  effective even when all other providers are unavailable.

## Phase 4 — Registry index + hub + blocklist

Signed JSON index (id → versions → tarball + sha256 + manifest + dossier
URL). `/providers` hub gains "Browse plugins". Signed blocklist (id +
version range + reason) disables into the toggles UI. Dossier URL mandatory
in index entries — dossier-first stays enforced.

- Guardrails: blocklist test (blocked plugin disables with reason shown);
  index signature test; hub test.

## Residue (not this plan)

Third-party execution remains blocked until phase 3's trust gate; paid/DRM lanes,
browser-automation plugins (refused by policy), third-party default indexes.
