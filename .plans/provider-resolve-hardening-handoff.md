# Provider Resolve Hardening — Handoff

Status: ready to implement. Three independent slices, ordered by risk.
Prereq: commits `2707bb21`, `f8f6cfda`, `7f1ce6d5`, `6247cf05` on `fix/windows-parity`.

## Context you need

`resolveWithFallback` in `packages/core/src/provider-engine.ts` now supports
**hedging**: with `hedgeDelayMs > 0` the next candidate starts alongside the
current one and the first success wins. It is enabled for `fast` (2.5s) and
`balanced` (5s) in `apps/cli/src/services/playback/provider-resolve-budget-policy.ts`,
off for `quality-first`.

Two consequences that matter for everything below:

1. **Concurrent resolves against different providers are now normal**, not rare.
   Anything doing read-modify-write on shared state is under real pressure.
2. **Provider ordering now decides who gets the head start**, so ordering
   quality matters more than it did when fallback was strictly sequential.

Non-obvious invariant, currently load-bearing: `persistProviderHealthDelta`
(`PlaybackResolveService.ts:~742`) is safe under concurrency _only_ because
there is no `await` between its `.get()` and `.set()`. JS single-threading makes
it atomic. **If anyone makes that function async, it becomes a real lost-update
race.** Worth a comment on the function; do not "improve" it into async.

---

## Slice A — small confirmed defects

Each is 1–5 lines. All four verified by reading the code; none are speculative.

### A1. Cancellation misread as a failed cache health check

`apps/cli/src/services/playback/PlaybackResolveService.ts:838-840`

```ts
if (options.signal?.aborted) {
  return { healthy: false, checked: true, strategy: policy.strategy };
}
```

`checked: true` + `healthy: false` is the caller's signal to **delete the cache
entry** (`:322-325`). A user-driven cancel is not a health failure, so
cancelling a resolve silently throws away a good cached stream and the next
play is a cache miss.

Fix: return `checked: false` on abort (the "we learned nothing" path, which
callers already treat as "use the cache as-is"), or add a distinct
`cancelled: true` the caller checks before deleting. Prefer the former — it
needs no caller changes.

Test: abort mid-probe, assert `cacheStore.delete` was not called.

### A2. Endpoint health only learns from timeout/network

`packages/core/src/provider-cycle-engine.ts:406-415`

```ts
switch (failure.failureClass) {
  case "candidate-timeout":
  case "candidate-network":
    return "transient";
  default:
    return null;
}
```

`null` means "record nothing". An endpoint returning unparseable data
(`candidate-parse`) or 403 (`candidate-blocked`) on every single cycle is never
quarantined and is retried forever.

The target vocabulary is `"route-dead" | "server-error" | "transient"`
(`packages/types/src/index.ts:400`). Quarantine behaviour, from
`apps/cli/src/services/playback/ProviderEndpointHealthService.ts`:

| class          | effect                                          |
| -------------- | ----------------------------------------------- |
| `route-dead`   | 24h quarantine, immediately                     |
| `server-error` | 1h quarantine, **only after 2 distinct titles** |
| `transient`    | 60s cooldown after 2 failures, in-memory only   |

Suggested mapping — note `server-error`'s two-distinct-titles gate is exactly
the "don't quarantine on one title's quirk" protection you want here:

- `candidate-parse` → `server-error`
- `candidate-blocked` → `server-error`
- `candidate-empty` → `null` (keep. A provider legitimately not having an
  episode is not an endpoint defect, and quarantining on it would blacklist
  good endpoints for sparse titles.)
- `candidate-expired`, `candidate-unsupported`, `candidate-unknown` → `null`

Do **not** map anything to `route-dead` from cycle failures. That class is for
confirmed 404/410 route removal and is seeded deliberately
(`bootstrap-persistence.ts:214`); a 24h quarantine off a parse error is too
harsh to trigger heuristically.

### A3. Corrupt `checkedAt` pins a provider to `down` forever

`apps/cli/src/services/playback/provider-health-policy.ts:25-26`

```ts
const checkedAtMs = Date.parse(stored.checkedAt);
const ageMs = Number.isFinite(checkedAtMs) ? Math.max(0, now.getTime() - checkedAtMs) : 0;
```

Unparseable timestamp → `ageMs = 0` → never reaches the 4h/8h heal thresholds →
`down` forever, and `down` providers are excluded from fallback so it can never
earn its way back.

Fix: fail **open**. An unparseable timestamp is unusable data, not evidence of
recent failure — treat it as fully aged (`Number.POSITIVE_INFINITY`, or heal to
`healthy` directly). Same bug shape, same fix, in `formatProviderHealthAge`
(`:66-67`) which already returns `"unknown age"` — that one is correct, use it
as the precedent.

### A4. Unguarded cache reads abort the whole resolve

`PlaybackResolveService.ts:286` (`cacheStore.get`) and `:292/296/301`
(`cacheStore.delete`).

`cacheStore.set` is already guarded (`persistResolvedStream:735-739`) and so is
`persistProviderHealthDelta`. The reads are not, so a SQLite failure (disk full,
corrupt DB) throws out of `resolve()` and no stream is returned — despite the
provider being perfectly able to serve one.

Fix: wrap the get/delete block so a cache fault degrades to a live resolve.
Match the existing comment style ("Cache persistence is best-effort").

**Scope note:** the audit that flagged this also claimed `.set()` and
`providerHealth.get()` were unguarded. They are not. Only the get/delete calls
above need changing.

---

## Slice B — provider health recovery

`down` is currently a 4-hour blind spot: excluded from fallback
(`isProviderFallbackEligible`, `provider-health-policy.ts:55-59`), so it cannot
succeed, so only the TTL heals it.

Note what is **already correct** and should not be "fixed": a successful
resolve resets `consecutiveFailures` to 0 and the provider returns to `healthy`
immediately (`PlaybackResolveService.ts:747-751`). The problem is purely that a
`down` provider never gets the chance to succeed.

**Manual reset already exists and works.** `/reset-provider-health` is fully
wired (`command-registry.ts`, `shell-workflows.ts`, settings registry, docs at
`.docs/title-provider-health-and-cache-reset.md`), so the user-facing note at
`PlaybackResolveService.ts:513` is honest. Nothing to fix there — do not
re-implement it.

The remaining gap is **automatic** recovery, so a user who does not know about
the command is not stuck for 4h:

**Shadow probe.** Occasionally resolve a `down` provider off the critical path
(do not surface its stream), and feed the real outcome to health. This replaces
a timer with evidence. Fits naturally as a hedge candidate that is never
selected as the winner — the machinery in `resolveHedged` already starts
candidates concurrently and aborts losers.

Guard it: probe at most one `down` provider per resolve, and never let a probe
extend the resolve deadline. A recovery mechanism that slows down the happy
path is a net loss.

---

## Slice C — latency-aware ordering

Two pieces of data are collected and then discarded:

- `ProviderCandidatePlanner.ts:76` — `void input.suggestion`. The title-level
  switch suggestion is computed, emitted as a UX event, then explicitly
  discarded for ordering.
- `PlaybackResolveService.ts:~762` — `medianResolveMs` is written into health
  state. Nothing reads it for ordering.

The existing comment says ordering "stays deterministic until a provider is
explicitly selected." **That is a deliberate choice, not an oversight** —
predictability is a real UX property. Do not simply sort by speed.

Proposed shape that keeps both:

- Primary sort key: user's configured priority (unchanged, still authoritative)
- Tie-break only: `effectiveStatus` (`healthy` before `degraded`), then
  `medianResolveMs`
- Demote `degraded` below all `healthy` providers of equal user priority

This changes nothing for a user with an explicit priority list covering their
providers, and helps everyone else. Hedging amplifies the benefit: the
better-ordered candidate gets the head start.

Related, lower priority: a provider stuck at `degraded` with 100 consecutive
failures is still fallback-eligible forever — there is no escalation from
`degraded` to not-eligible. Consider whether the tie-break demotion above is
sufficient (it probably is) before adding another threshold.

---

## Also worth doing, not scoped here

**Hedge inside `runProviderCycle`.** Same fix one level down. Videasy walks 11
candidates × 20s sequentially (`packages/providers/src/videasy/direct.ts:150`,
`:555-557`) — the worst tail in the codebase. `resolveHedged` in
`provider-engine.ts` is a working pattern to copy. Larger than the slices above;
treat as its own piece of work.

**Tune the hedge delays with real data.** 2.5s/5s are reasoned, not measured.
The right value is roughly the primary provider's p50 resolve time, and
`medianResolveMs` is already persisted. Ship, watch traces, adjust.

---

## Ground rules

- `bun run typecheck`, `bun run lint`, `bun run fmt`, `bun run test` before
  finishing. Do not use `bun test` directly.
- There is a **pre-existing** typecheck error in
  `apps/cli/src/image/renderers/index.ts` (`"sixel"` not in `ImageRendererId`)
  from unrelated in-progress work. Not yours; leave it.
- The repo forbids non-null assertions (`no-non-null-assertion`). Restructure to
  satisfy it rather than reaching for `!`.
- Slices A, B, C are independent. A is the safest starting point.

## Calibration note

This handoff descends from an automated audit whose severity labels were
unreliable — roughly a third of its "critical/high" findings were impossible
(a race with no await point), already handled (guarded cache writes), or
supported by fabricated evidence (a claimed missing `.toLowerCase()` that is
present on the line cited). Everything in _this_ document was verified by
reading the code. If you receive further findings from that audit, verify before
implementing.
