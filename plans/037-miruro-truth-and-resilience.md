# Plan 037: Make Miruro resolution evidence truthful and resilient

> **Drift check:** `git diff --stat 36da54c4..HEAD -- packages/providers/src/miruro packages/providers/test/miruro-inventory.test.ts apps/cli/test/live/miruro-demonslayer.smoke.ts .docs/provider-dossiers/miruro.md`

**Goal:** Miruro must not claim a stream was reachable without a probe, and a pipe
key/server-order change must fail with actionable evidence rather than silent
provider exhaustion.

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Planned at:** `36da54c4`, 2026-08-11

## Confirmed defects and corrections to the proposed audit

- The hardcoded pipe key is a rotation risk, but no trustworthy derivation route has
  been demonstrated. Do not promise automatic re-derivation yet.
- `createMiruroResultFromPayload` sets `streamReachabilityVerified:true` without a
  reachability probe.
- `MIRURO_SERVER_TRY_ORDER` and `defaultServers` disagree. One canonical list should
  drive both discovery and fallback construction.
- AniList id extraction is duplicated in resolve/list paths.
- The WAF threshold of two currently equals the two configured mirrors. That is not
  inherently a bug; retain or change it only with a failure-sequence test.

## Tasks

- [ ] Add result-builder tests that default reachability to false/unknown and set it
  true only when a probe result is passed explicitly.
- [ ] Thread actual cycle/stream probe evidence into the builder; otherwise omit the
  attestation.
- [ ] Replace `defaultServers` with the canonical try order and test exact ordering,
  including `bonk` last.
- [ ] Reuse `resolveMiruroAnilistId` everywhere and accept only a proven numeric
  AniList id.
- [ ] Classify pipe failures distinctly: WAF HTML, decode/key mismatch, unexpected
  obfuscation version, JSON shape drift, and network timeout. Never log the key or
  encrypted body.
- [ ] Isolate pipe decoding behind a versioned internal seam so a captured fixture
  can prove a rotated key/version. On mismatch, fail loud with a provider diagnostic.
- [ ] Treat key derivation as a separate provider-intake investigation. Implement it
  only if a reproducible first-party script/bootstrap source is documented.
- [ ] Add subtitle content-type/extension characterization before changing the
  current `.vtt`/SRT classification.
- [ ] Keep Miruro manually selectable until its live smoke resolves and probes a
  reachable stream in the target release region.

## Verification

```sh
bun run --cwd packages/providers test test/miruro-inventory.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run test:live:miruro
```

**STOP:** no first-party or reproducible key source exists. Ship diagnostics and
fail-closed behavior; do not scrape/minify-guess a secret at runtime.
