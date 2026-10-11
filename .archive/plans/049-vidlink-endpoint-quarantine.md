# Plan 049: Bring VidLink inside the endpoint-quarantine machinery

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- packages/providers/src/vidlink/ packages/providers/src/runtime/fetch.ts packages/types/src/index.ts`
> Mismatch → re-read `vidlinkFetch`/`encryptTmdbId` and the `EndpointHealthPort` shape before proceeding.

Closes #194.

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED — touching a live provider's retry/classification path; keep the retry budget and backoff semantics identical
- **Depends on:** none. (#390 wires `endpointHealth` into rivestream/miruro cycling — same port, no file overlap; merge order irrelevant. #329 touches VidLink's relay allowlist, not this fetch path.)
- **Category:** bug / security-adjacent (unbounded re-probe of a throttled host)
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

VidLink has a hard dependency chain `enc-dec.app → vidlink.pro` with no
quarantine participation. Two concrete defects, both verified on `main`:

1. **Every non-OK HTTP status collapses to a retryable `network-error`-class
   failure.** A persistent 429 or 403 retry-storms on every resolve and writes
   negative health on each pass. Rivestream already classifies via
   `ProviderHttpError` (`rivestream/direct.ts:24,601`); VidLink throws plain
   `Error`s.
2. **No `endpointHealth` reads or writes.** When a rate-limit state persists,
   VidLink re-pays the full enc-dec + API cost on every resolve with no circuit
   breaker. The `enc-dec.app` single point of failure is an accepted
   constraint (`vidlink/manifest.ts:45`) — this plan does not remove the SPOF,
   it makes the SPOF quarantinable.

## Current state

`packages/providers/src/vidlink/direct.ts`:

```ts
// :204-210 — the VidLink API fetch loop
if (response.ok) return response;
if (attempt < maxAttempts && response.status >= 500 && !signal?.aborted) {
  lastError = new Error(`VidLink API returned HTTP ${response.status}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  continue;
}
throw new Error(`VidLink API returned HTTP ${response.status}`);
```

```ts
// :237-238 — the enc-dec.app call
if (!response.ok) {
  throw new Error(`enc-dec.app returned HTTP ${response.status}`);
}
```

The machinery to adopt (all already on `main`):

- `EndpointHealthPort` — `packages/types/src/index.ts:631`
  (`context.endpointHealth` on `ProviderRuntimeContext`).
- `createVideasyEndpointHealth(context)` — `videasy/direct.ts:184`; the
  per-endpoint wrapper pattern to copy. Videasy records
  `endpointHealth.recordFailure(server, { class: "transient", titleId })`
  (:1662+) and `endpointHealth.recordSuccess(server)` (:1776).
- `ProviderHttpError` — `packages/providers/src/runtime/fetch.ts:8`; carries
  `status`, `code: ResolveErrorCode`, `retryable`. Relevant codes
  (`packages/types/src/index.ts:348`): `"rate-limited"`, `"blocked"`,
  `"not-found"`, `"network-error"`, `"timeout"`, `"cancelled"`.
- `resolve-helpers.ts` `createExhaustedResult` accepts the classified failure —
  health-neutral codes (`cancelled`, `unsupported-title`) skip `healthDelta`
  automatically; the rest write negative health once, correctly.
- Cancellation guard: the engine wraps `context.endpointHealth` in
  `guardEndpointHealthAgainstCancellation` (`core/src/provider-engine.ts:228`),
  so recording on abort is already safe — do not re-guard.

**Critical rule from #267 that applies verbatim here:** `not-found` means
_this service does not carry this title_ — it is not health evidence. Only
transport failures (5xx, timeouts, connection errors) and 429/403
(rate-limit/WAF) may feed endpoint health. A 404 from VidLink must never mark
a host unhealthy.

## Commands

| Purpose                                    | Command                                    | Expected         |
| ------------------------------------------ | ------------------------------------------ | ---------------- |
| Provider unit tests                        | `bun run --cwd packages/providers test`    | all pass         |
| VidLink live smoke (opt-in, needs network) | `bun run --cwd apps/cli test:live:vidlink` | resolves streams |
| Full suite                                 | `bun run test --force`                     | 0 failures       |
| Typecheck                                  | `bun run typecheck --force`                | exit 0           |
| Lint/fmt                                   | `bun run lint --force && bun run fmt`      | exit 0           |

## Scope

**In scope:**

- `packages/providers/src/vidlink/direct.ts`
- `packages/providers/test/` — new or extended VidLink tests
- `.docs/providers.md` — one-line note that VidLink participates in endpoint health (docs land in the same change set per repo rules)
- `.changeset/` — user-facing fix requires a changeset (`bunx changeset`, patch, `@kitsunekode/kunai`)

**Out of scope:**

- `apps/cli` resolve service — the engine already persists `healthDelta`.
- Relay allowlist (#329 owns that file path on its stack).
- Removing the `enc-dec.app` dependency or adding a second encoder — accepted SPOF.
- Videasy/Rivestream/Miruro health behavior — owned by their PRs.

## Steps

### Step 1: Classify HTTP failures with `ProviderHttpError`

Replace the bare `Error` throws at `direct.ts:206,210,238` (and any other
non-OK throw in the file) with `ProviderHttpError` carrying:

- `status`: the response status
- `code`: `429 → "rate-limited"`, `401/403 → "blocked"`, `404 → "not-found"`,
  `5xx → "network-error"`, else `"unknown"`
- `retryable`: `false` for 4xx except 429 (retryable with backoff),
  `true` for 5xx/network
- `providerId: "vidlink"`, `stage`: `"api"` vs `"enc-dec"` so a trace names
  which leg failed

Check how rivestream maps status→code (`rivestream/direct.ts:962` area) and
match it — same convention, no new enum.

**Verify:** `bun run --cwd packages/providers test` → all pass (existing VidLink tests should still pass; if any asserted on the literal error message, update the assertion to the classified code).

### Step 2: Wire `endpointHealth` into both legs

Add a `vidlinkEndpointHealth(context)` helper modeled on
`createVideasyEndpointHealth` — a thin adapter keying on endpoint host
(`api.vidlink.pro`, `enc-dec.app`):

- Before each leg: `shouldTry(endpoint)` — if quarantined, skip straight to the
  classified failure (`"rate-limited"`/`"network-error"` per the recorded class)
  without spending a request. A skipped `enc-dec.app` fails the whole resolve
  fast (it is a hard dependency), which is the intended behavior.
- On `ProviderHttpError` with `code` in `{"rate-limited","blocked","timeout","network-error"}`:
  `recordFailure(endpoint, { class: <map code→class>, titleId })`.
  `not-found` records nothing.
- On success: `recordSuccess(endpoint)`.
- Cancellation: do not record (the engine's guard covers it; just don't
  record on `signal.aborted`).

Find the failure `class` vocabulary from `packages/storage/src/repositories/provider-endpoint-health.ts` (or wherever `EndpointHealthPort.recordFailure` is defined) and use those literals exactly.

**Verify:** `bun run --cwd packages/providers test` → all pass.

### Step 3: Tests

In `packages/providers/test/` (model after `rivestream-gate-failure-class.test.ts`
/ `endpoint-scoped-failure.test.ts` shape):

- 429 from vidlink.pro → `code: "rate-limited"`, retryable, endpoint
  `recordFailure` called once; second resolve skips the request entirely.
- 403 → `"blocked"`, recorded.
- 404 → `"not-found"`, **no** `recordFailure` call (assert the spy is empty —
  this is the #267 trap).
- enc-dec.app 500 → classified + recorded against the enc-dec endpoint, and
  the VidLink API leg is never attempted.
- `signal.aborted` mid-retry → no health write.

Use the existing injected-`fetch`/`endpointHealth` test doubles in
`packages/providers/test/` — no real network, no real timers (the 500ms retry
`setTimeout` must be injected or the signal-driven path used; check how
existing VidLink tests handle it first).

**Verify:** `bun run --cwd packages/providers test` → all pass incl. new cases.

### Step 4: Docs + changeset

- `.docs/providers.md`: add VidLink to whatever endpoint-health
  participation list exists there (find the section covering videasy).
- `bunx changeset` → patch `@kitsunekode/kunai`, message like
  `fix(vidlink): classify HTTP failures and honor endpoint quarantines`.
- `bun run guard` must pass.

## Test plan

- New tests in `packages/providers/test/` per Step 3.
- Structural pattern: rivestream's failure-class tests.
- Verification: `bun run --cwd packages/providers test` → all pass, N new tests.

## Done criteria

- [ ] No `new Error(\`... HTTP ${...}\`)`remains in`vidlink/direct.ts`— all non-OK statuses classify through`ProviderHttpError`
- [ ] `endpointHealth.shouldTry`/`recordFailure`/`recordSuccess` are consulted on both the API and enc-dec legs
- [ ] 404/`not-found` never writes endpoint health (asserted by test)
- [ ] Cancelled resolves write no health (asserted by test)
- [ ] `bun run test --force` exits 0
- [ ] Changeset present; `bun run guard` passes
- [ ] `.docs/providers.md` updated in the same commit set

## STOP conditions

- `EndpointHealthPort`'s failure `class` vocabulary turns out to be per-provider
  enums rather than shared literals — report before inventing new ones.
- VidLink's retry loops were rewritten by a merged PR (e.g. #337-style drift
  hardening) — re-read, do not patch blindly.
- Any test needs a real `sleep` to pass — wrong approach; the repo forbids it.

## Maintenance notes

- When #390 lands, VidLink automatically joins `/reset-provider-health` and
  the endpoint-quarantine UI — verify the reset clears VidLink's quarantine
  rows in review.
- If enc-dec.app is ever replaced or mirrored, the endpoint keys here are the
  seam to extend.
