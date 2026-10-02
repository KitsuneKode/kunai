# Plan: Rotate provider constants without a release (signed data-only feed)

> **Drift check (run first):** `git grep -n "ALLMANGA_CRYPTO_PROFILE" -- packages/providers` and read the header comment of `packages/providers/src/allmanga/crypto.ts` — if the rotation list there has grown, the cadence argument below is stronger, not weaker.

## Status

- **Status:** PROPOSED — design spike only. No code.
- **Priority:** P2
- **Effort:** M for AllManga alone, then S per additional provider
- **Risk:** MED — it adds a remotely updated input to a security-sensitive path
- **Depends on:** the Ed25519 verification that #507/#523 introduce for installers (reuse the key handling, do not invent a second scheme)
- **Category:** reliability / architecture

## Why this matters

AllManga rotates every constant at once, on a short cadence. The header of `packages/providers/src/allmanga/crypto.ts` lists build 140 → 166 → 171 → 177, and says a partial update "fails exactly like no update." Each rotation today is: re-extract, edit constants, run `bun run test:live:allmanga-crypto`, cut a release, wait for users to upgrade. Between the rotation and the upgrade, AllManga is down for everyone.

The code already has the right shape for fixing this: everything that rotates lives in one `ALLMANGA_CRYPTO_PROFILE` object, and `BUNDLED_ALLMANGA_CRYPTO` is already the fallback when live bootstrap material is unavailable (`api-client.ts`). A hot-updatable profile is a replacement for that one object, not a plugin system.

## Design

- **Data only, never code.** The feed carries the profile fields that rotate (build id, mask fragments, derivation constants, query hash, field order). It carries no URLs, hosts, or executable content. Endpoints (`ALLMANGA_BOOTSTRAP_URL`, `ALLMANGA_SITE_ORIGIN`) stay in code behind the existing host allowlist, so a feed cannot redirect traffic.
- **Signed.** Ed25519 over a canonical encoding, public key pinned in the binary. Reuse the installer's key and verification helper from #507/#523.
- **Atomic.** A profile is applied whole or not at all. Validate against a schema in `@kunai/schemas` first.
- **Anti-rollback and expiry.** A monotonic sequence number and an expiry, so an old signed feed cannot be replayed.
- **Last-known-good, then bundled.** Order: fresh verified feed → cached verified feed → `BUNDLED_ALLMANGA_CRYPTO`. A failed fetch or verification never makes things worse than today.
- **Opt-out and honesty.** One config key to disable it, shown in `/diagnostics`. This is a new network call, so it is covered by the analytics-and-privacy review (`.docs/analytics-privacy-contract.md`) even though it sends nothing about the user.
- **Where it is served.** A static file on the docs site or a release asset. Not the relay (relay stays metadata-only RPC for providers).

## Non-goals

- A general plugin or provider-loading system. The audit rejected that (`.plans/2026-09-30-codebase-audit.md`), and this spike does not reopen it.
- Remote control of which providers are enabled, ordering, or quality policy.
- Feed-delivered code, regexes executed from data, or URLs.

## Open questions to settle before building

1. Key custody: who can sign, where the private key lives, how it rotates, and what happens if it leaks (a bad feed can break AllManga for everyone who fetches it, so there needs to be a revocation story and a kill switch that does not itself need a release).
2. Does a verified feed need a freshness check against live behaviour (the `allmanga-rotation` smoke) before it is published? Recommended: yes, CI publishes only a profile that passed it.
3. Which other providers rotate often enough to justify it. Measure from git history before adding any.

## Related finding: `Bun.secrets`

`Bun.secrets` exists in the pinned Bun (1.4.2): `get`, `set` and `delete` are all functions, checked with `typeof` only, not exercised. Plan 052's remaining residue is a native Keychain binding to remove the `security -w` argv exposure, so `Bun.secrets` is a candidate to evaluate there. That is a separate change from this spike; it needs a behaviour check on macOS, Linux (libsecret) and Windows before anyone relies on it.

## Acceptance for the spike

A written decision on questions 1–3, a schema, and one end-to-end test with a fake feed: valid feed applied, bad signature rejected, replayed old feed rejected, expired feed ignored, network failure falling back to the bundled profile.
