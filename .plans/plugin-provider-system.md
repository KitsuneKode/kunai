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

- Scan `~/.config/kunai/providers/<id>/`, read `kunai-plugin.json`,
  validate the manifest against `@kunai/schemas`, check `engineCompat`,
  `import()` the entry, register into the engine + registry + ordering +
  toggles. Load failures quarantine with named errors, never crashes.
- Migrate ONE bundled provider (movy: smallest surface, best fixtures)
  onto the loader while still shipping it bundled.
- Guardrails: manifest schema test, boundary test extended to plugin
  entries (no `@/app*`, no `process.env`/fs/Bun imports), quarantine test,
  doc-paths + frontmatter clean.

## Phase 2 — `provider check` kit

Extract from existing tests into a runnable kit: manifest validation, gate
coverage (must probe via `verifyCandidateStream`), capability honesty,
forbidden imports, live smoke on pinned titles. `kunai provider check <dir>`
runs it. `kunai provider init <id>` scaffolds from `_template.ts` plus a
prefilled dossier.

- Guardrail: the kit must pass the migrated movy plugin and fail a
  deliberately-broken fixture plugin.

## Phase 3 — URL install MVP (no registry yet)

`kunai plugin install <url>`, `remove`, `info`: download, checksum-pin
against the manifest signature, validate, run `check`, register. Updates
re-validate and re-run `check` before swapping.

- Guardrails: checksum mismatch refuses with reason; downgrade warns;
  install surfaces the plugin's `permissions.hosts` for explicit consent.

## Phase 4 — Registry index + hub + blocklist

Signed JSON index (id → versions → tarball + sha256 + manifest + dossier
URL). `/providers` hub gains "Browse plugins". Signed blocklist (id +
version range + reason) disables into the toggles UI. Dossier URL mandatory
in index entries — dossier-first stays enforced.

- Guardrails: blocklist test (blocked plugin disables with reason shown);
  index signature test; hub test.

## Residue (not this plan)

Worker/subprocess isolation (v2, on earned distrust), paid/DRM lanes,
browser-automation plugins (refused by policy), third-party default indexes.
