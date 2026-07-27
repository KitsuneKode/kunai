# The Resolve Loop — Design

Status: Approved design, not yet planned
Date: 2026-07-28
Supersedes nothing. Complements `docs/superpowers/specs/2026-07-25-telemetry-privacy-and-observability-design.md`.

## 1. Purpose

Make Kunai's stream resolution fast and reliable enough that the provider layer's
inherent messiness never reaches the user.

The thesis, in the user's framing: Cursor's edge is not the editor or the model —
it is the loop around the model. Kunai's edge is not the providers — every
competitor scrapes the same sites — it is the loop around the providers.

This design covers that loop: instrumenting it, racing it, keeping it warm, and
making provider manifests tell the truth about what they can do.

### Non-goals

- **No provider-data UI.** The harness should make provider mess invisible, not
  surface it. A source picker is the opposite of this design's intent.
- **No new providers.** Coverage (P-Stream / movie-web parity) is a separate
  project that only pays off once the loop can pick quickly among many sources.
- **No reordering of the telemetry spec's phases.** This design inserts a
  local-only sink ahead of Phase 1; Phases 1–7 keep their existing order.
- **No repo housekeeping.** Stale worktrees, stale plan checkboxes, and test
  pollution are being fixed separately as direct commits.

## 2. The distinction that drives the design

"Telemetry" means two different things in this repo, and conflating them is the
central trap.

|                    | Product analytics                            | Resolve diagnostics                                                      |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------ |
| Lives in           | `apps/telemetry-ingest`, `diagnostic_events` | `resolve_traces` (local cache DB)                                        |
| Leaves the machine | Yes, opt-in                                  | **Never**                                                                |
| Shape              | `AnalyticsEvent` — closed, privacy-stripped  | `ResolveTrace` — full detail                                             |
| Answers            | "how many installs on 0.3.0 / linux / arm64" | "why did videasy take 45s on this title"                                 |
| Status             | Phase 0 landed and correct                   | **Schema, repository, migration, and pruning all exist; nothing writes** |

`AnalyticsEvent` deliberately cannot represent a `titleId`, URL, or free text —
enforced by the type, not by redaction (telemetry spec §8, §9). That is correct
for data that leaves the machine, and it is exactly why that type can never
diagnose a resolve.

`ResolveTraceRepository` is exported from `@kunai/storage` and instantiated only
in tests. `resolve_traces` has zero rows. Every claim about resolve performance
is therefore currently unfalsifiable — including the claims in this document.

## 3. Architecture: one capture point, two sinks

```
resolve pipeline
  emits rich events (titleId, endpoint, candidateId, failureClass, durationMs)
        │
        ├──> ResolveTraceSink ──────> resolve_traces (local, full detail, never sent)
        │                              ↳ consumed by: hedge tuning, quarantine
        │                                 evidence, health scoring, ordering
        │
        └──> AnalyticsProjection ───> diagnostic_events (category = 'analytics')
                                       ↳ closed AnalyticsEvent shape, opt-in
```

Three properties justify this shape:

1. **The projection is lossy by construction.** `AnalyticsEvent` is produced
   _from_ the rich event by dropping fields, so the privacy guarantee becomes a
   single pure function `richEvent -> AnalyticsEvent`. Telemetry spec §9's
   invariant 2 — serialize against a fixture session containing known titles and
   assert none appear — becomes one function to fuzz rather than a discipline
   maintained across scattered call sites.
2. **One instrumentation pass, not two.** The telemetry spec's Phase 5 capture
   points (`provider.resolve.start` / `.end` / `.error` / `.fallback`) are the
   same points the trace sink needs. Instrumenting them separately guarantees
   drift.
3. **It unblocks the local sink immediately.** Traces never leave the machine, so
   they need no consent tier, no identity model, and no Postgres. The analytics
   projection lands when Phase 5's turn comes, against a seam that already exists.

### Retention

`resolve_traces` already has pruning in `packages/storage/src/maintenance.ts`.
No new retention mechanism. Traces are debugging evidence with a short window,
not an archive.

## 4. What the traces are for

Traces are not an end in themselves. Each consumer below is currently either
guessing or broken, and becomes evidence-driven once traces exist.

### 4.1 Honest provider health

`resolveEffectiveStatus` (`apps/cli/src/services/playback/provider-health-policy.ts:45`)
reads only `status` and age. `recentFailureRate` is computed, persisted, and
never read.

Observed consequence on the live cache DB (2026-07-28):

| provider | recentFailureRate | status     |
| -------- | ----------------- | ---------- |
| vidlink  | **1.0**           | `healthy`  |
| allanime | 0.76              | `degraded` |

vidlink reports healthy at a 100% recent failure rate because `status` is driven
by `consecutiveFailures`, which was 1.

Change: `recentFailureRate` becomes an input to effective status. Traces give it
a real denominator instead of a decaying estimate.

### 4.2 Quarantine that actually fires

Endpoint quarantine requires `server-error` across **two distinct titles**
before quarantining for 1h. That gate exists for a good reason — one title's
quirk should not blacklist a working endpoint.

But it is defeated by normal viewing. Observed: all 8 videasy endpoint rows have
recorded failures, up to 5 consecutive (`wings-meine`), and **every single one
has an empty `quarantined_until`.** Every row lists exactly one distinct title,
because a user watching one show hammers one title.

Change: replace the two-distinct-titles proxy with trace evidence — consecutive
failures across distinct _resolve attempts_ for the same endpoint, which is what
the rule was always trying to approximate. The protection against single-title
quirks is preserved; the blindness to single-title usage is not.

### 4.3 Hedge tuning

Hedge delays (2.5s `fast`, 5s `balanced`) are documented in
`.plans/provider-resolve-hardening-handoff.md` as "reasoned, not measured". The
right value is roughly the primary provider's p50 resolve time.

There is also an open question recorded from the hedging work: hedging makes the
user's configured provider priority advisory and doubles outbound load against
scraped sites. `provider.resolve.hedge-outcome` already records
`winnerWasHedged`. Aggregating it decides whether hedging stays on by default.
That aggregation needs traces.

## 5. The harness

Four changes. Speculative prefetch is **not** among them —
`apps/cli/src/app/playback/episode-prefetch.ts` already implements it and is
wired at `PlaybackPhase.ts:2133`.

### 5.1 Race candidates instead of walking them

`resolveHedged` in `packages/core/src/provider-engine.ts` races _providers_.
One level down, `runProviderCycle` is strictly sequential: videasy walks up to 11
candidates at `VIDKING_CYCLE_CANDIDATE_TIMEOUT_MS` = 20s each
(`packages/providers/src/videasy/direct.ts:150`). This is the worst tail in the
codebase and the single largest win available for "resolves are slow".

The pattern to copy exists one level up.

**Hard prerequisite — the cancellation trap.** Providers record endpoint health
from _inside_ their own resolve. Racing aborts the slower candidate on every race
it loses, and that abort lands in the provider's catch block, reporting a failure
for an endpoint that did nothing wrong. Left unguarded, candidate-level racing
would steadily quarantine healthy-but-slower endpoints, invisibly — the same bug
that provider-level hedging had.

The guard already exists at the engine level:
`packages/core/src/provider-attempt-cancellation.ts` wraps the
`EndpointHealthPort` and drops failure writes issued after a cancellation. It
distinguishes cancellation from an attempt's own timeout via the typed
`ProviderAttemptTimeoutError` (`provider-engine.ts:684`), because a bare
`signal.aborted` check would also discard genuine timeout evidence that feeds the
transient cooldown.

Candidate-level racing must route its health writes through that same wrapper.
The rule is a property of cancellation, not of any one provider, so it does not
get reimplemented per scraper.

### 5.2 Background health probing

Nothing checks provider health off the critical path. Users are the probe:
youtube's health was last checked 2026-07-20, eight days before this design.
A `down` provider is excluded from fallback, so it cannot succeed, so only a 4h
TTL heals it.

Adopt Slice B from the handoff doc: probe at most one `down` provider per
resolve, off the critical path, never surfacing its stream and never extending
the resolve deadline. It fits as a hedge candidate that is never selected as
winner — `resolveHedged` already starts candidates concurrently and aborts losers.

A recovery mechanism that slows the happy path is a net loss; the deadline
guarantee is not optional.

### 5.3 Latency-aware ordering

`medianResolveMs` is persisted by `PlaybackResolveService` and read by nothing.

Ordering stays deterministic — predictability is a real UX property and the
current behaviour is a deliberate choice, not an oversight. So latency enters as
a **tie-break only**:

- Primary key: user's configured priority (unchanged, authoritative)
- Tie-break: `effectiveStatus` (`healthy` before `degraded`), then `medianResolveMs`

A user with an explicit priority list covering their providers sees no change.
Everyone else gets better ordering, and hedging amplifies it because the
better-ordered candidate gets the head start.

### 5.4 Finish the in-flight hardening

Five provider files carry uncommitted work. Three are correct and land as-is;
two must not.

| Change                                     | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `allmanga` abortable retry sleep           | **Keep.** `Bun.sleep(3200)` ignored the signal, so cancelling during rate-limit backoff waited the full delay.                                                                                                                                                                                                                                                                                                                                                                 |
| `youtube` invidious + piped fetch timeouts | **Keep.** Those `fetch` calls had no timeout at all; a hung instance hung forever.                                                                                                                                                                                                                                                                                                                                                                                             |
| `videasy` reordered `signal.aborted` check | **Delete, do not reorder.** Redundant with the engine guard (§5.1) and over-broad — it cannot distinguish cancellation from the attempt's own timeout, so it discards timeout evidence. Per the cancellation rule, local `signal.aborted` guards inside providers should be removed.                                                                                                                                                                                           |
| `videasy` WASM init timeout                | **Rewrite.** The `setTimeout` is never cleared, so it fires 10s after every call including successful ones and sets `wasmExportsPromise = null`, discarding the memoized module and forcing re-instantiation on every subsequent resolve. The `.catch` fallback then tests `if (wasmExportsPromise)`, which the timeout just nulled, making the branch dead. Net effect is a slower videasy. A correct version clears the timer on settle and does not null a successful memo. |
| `vidlink` enc-dec cache                    | **Bound it.** Right idea; an unbounded module-level `Map` is a leak shape this repo has been bitten by. Add a size cap, and compute `expiresAt` after the request rather than before.                                                                                                                                                                                                                                                                                          |

## 6. Provider capability truth

The audit finding is the inverse of the expected one: manifests **understate**
what the code does.

| Provider           | Declared                         | Actual                                         | Action        |
| ------------------ | -------------------------------- | ---------------------------------------------- | ------------- |
| youtube            | no `subtitle-resolve`            | builds `SubtitleCandidate[]` (`direct.ts:383`) | fix manifest  |
| miruro             | no `subtitle-resolve`            | models subtitle delivery                       | fix manifest  |
| vidlink            | no `multi-source`                | genuinely single-source                        | correct as-is |
| rivestream, miruro | `research.ts` says `"candidate"` | in the production registry                     | fix metadata  |

Severity is moderate, not urgent: manifest `capabilities` is descriptive and does
not currently gate routing — the runtime `ProviderCapabilities` in
`apps/cli/src/services/providers/Provider.ts:39` is a separate structure. The
cost of leaving it wrong is that it misleads humans and would silently
under-serve any future capability-based routing.

One real question this section raises and §4.1 answers with data rather than
opinion: whether vidlink earns its place in the registry at a 100% recent failure
rate.

## 7. Release readiness

The requirement is that the main providers work well enough that this stops being
a worry after the current release. That is a verification problem, and the
verification harness already exists — it has simply not been run.

`apps/cli/test/live/release-provider-signoff.ts` classifies every failure as one
of three things, which is exactly the fork this design turns on:

| class                 | meaning                                | who fixes it             |
| --------------------- | -------------------------------------- | ------------------------ |
| `provider-drift`      | upstream changed or died               | provider work / coverage |
| `environment-network` | local network, geo-block, relay        | not a code defect        |
| `harness-failure`     | our loop mishandled a working provider | **this design**          |

It covers the three required lanes (`movie`, `series`, `anime`) and has a 24h
staleness bound (`RELEASE_SIGNOFF_MAX_AGE_MS`).

**Caveat that must be respected when running it:** the smoke harness calls
`createContainer({ debug: true })`, so it uses the real user profile and writes
to the live cache and data databases. It is env-gated behind
`KUNAI_LIVE_RELEASE_SIGNOFF=1`. Back up before a run, or accept that provider
health and stream cache will be mutated. It is not safe to run casually in a loop.

### Release gates

These are gates, not nice-to-haves. Each is currently unanswered:

1. **Signoff is green across all three lanes**, with any failure classified. A
   `provider-drift` failure is an accepted release risk if documented; a
   `harness-failure` is not.
2. **The hedging default is decided by data, not by assumption.** Hedging is on
   by default (`balanced` → 5s). It makes the user's configured provider priority
   advisory and doubles outbound load against sites we scrape. `winnerWasHedged`
   is already recorded in `provider.resolve.hedge-outcome`; aggregate it. If the
   hedged candidate rarely wins, the default goes off — the cost is real and the
   benefit is currently unmeasured.
3. **No provider ships reporting `healthy` at a sustained high failure rate.**
   vidlink's current 100% recent failure rate is either a real defect to fix or
   grounds to drop it from the default registry. Decided with §4.1's data.
4. **The candidate-racing cancellation guard is proven by test** (§5.1), because
   getting it wrong quarantines healthy endpoints invisibly — the worst possible
   failure mode, since it degrades silently over time rather than failing loudly.

## 8. Testing

- **Privacy:** the `richEvent -> AnalyticsEvent` projection is serialized against
  a fixture session containing known titles, queries, and file paths; output is
  asserted to contain none of them. This is telemetry spec §9 invariant 2,
  narrowed to one function.
- **Cancellation:** a raced candidate that loses records **no** endpoint failure;
  a candidate that genuinely times out **does** record one. These are distinct
  assertions and both are required — collapsing them is the bug in §5.4.
- **Quarantine:** repeated failures against one endpoint for a single title
  quarantine it; failures spread across unrelated endpoints do not.
- **Health:** a provider at a high `recentFailureRate` with low
  `consecutiveFailures` does not report `healthy` (the vidlink case).
- **Deadline:** a shadow probe never extends resolve wall time. Assert against a
  budget, not a mock call count.
- **Ordering:** a user with an explicit full priority list observes byte-identical
  ordering before and after §5.3.

## 9. Sequencing

This document is a design of record, deliberately larger than one plan's worth of
work. Each step below gets its own implementation plan, in the same way the
telemetry spec spans Phases 0–7.

The instrumentation lands first because everything after it is otherwise tuned
blind.

0. **Baseline** — run the release signoff (§7) once to classify current failures,
   and capture a traced latency baseline immediately after step 1. Without a
   before-measurement, step 4's success criterion is unfalsifiable.
1. **Trace sink** — wire `ResolveTraceRepository`, emit at the resolve capture
   points, prune via existing maintenance.
2. **Honest health + quarantine** (§4.1, §4.2) — the two evidence-backed defects.
3. **Finish in-flight hardening** (§5.4) — independent of 1 and 2; unblocks 4.
4. **Candidate racing** (§5.1) — the largest latency win; requires §5.4's
   cancellation cleanup to be correct first.
5. **Background probing + ordering** (§5.2, §5.3).
6. **Capability truth** (§6) — independent, can land any time.
7. **Release gates** (§7) — re-run signoff, decide the hedging default from
   aggregated `winnerWasHedged`, decide vidlink's fate from §4.1's data.
8. **Analytics projection** — when telemetry Phase 5 comes up, against the seam
   built in step 1.

Steps 0–4 and 7 are the release-blocking path. Steps 5, 6, and 8 can land after.

## 10. Acceptance

- `resolve_traces` is non-empty after a normal session, and prunes.
- No provider reports `healthy` at a sustained high failure rate.
- A persistently failing endpoint acquires a `quarantined_until` under
  single-title viewing.
- videasy's p95 resolve time drops against the traced baseline from step 0. The
  target is set from that baseline once it exists rather than guessed here; the
  binding requirement is that the comparison is made against recorded numbers,
  not impressions.
- A raced candidate that loses writes no endpoint-health failure.
- Provider manifests match provider behaviour.
