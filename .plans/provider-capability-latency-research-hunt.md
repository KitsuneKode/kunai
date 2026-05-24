# Provider Capability And Latency Research Hunt

Status: Ready for a new coordinator session; research only

Date: 2026-05-25

## Goal

Produce an evidence-backed audit of what each active provider exposes, what
Kunai currently preserves or discards, where playback resolution performs
avoidable work, and which backend improvements would improve latency and
richness without adding routine provider traffic.

This is not an implementation plan. It is the research handoff required before
another provider optimization implementation pass.

## Why This Is A Separate Track

The local provider engine foundation is already implemented:

- `ResolveWorkKey` and in-flight join behavior exist for exact playback and
  prefetch work.
- The resolve ledger records cache, provider attempt, joined-lane, and
  provider-fact evidence.
- Fresh cache trust, stale/dead validation, offline health-skip policy, and
  classified resolve copy are implemented.
- Source inventory and UI projection already carry rich facts when adapters
  expose them.

The open question is not whether Kunai needs another resolver architecture.
The question is where provider-specific facts and request patterns can make the
existing architecture faster, richer, and more truthful.

## Non-Negotiable Guardrails

- Research first. Do not modify production resolver or provider behavior in
  this pass.
- Treat code and deterministic fixtures as truth when older docs disagree.
- Do not import code from `apps/experiments` into production.
- Do not run routine live provider requests.
- Any live provider check is manual-diagnostic work and requires explicit
  approval with a pinned fixture and narrowly stated purpose.
- Do not store raw token-bearing stream URLs, cookies, auth-like headers,
  subtitle URLs, or local user paths in durable reports.
- Separate playable truth, catalog truth, presentation hints, and diagnostics
  evidence.
- Measure richness separately from request cost. A capability is not an
  automatic win when it adds expensive work to the blocking path.
- Keep the future aggregate health/Cloudflare service out of this research
  implementation track. It may be listed as a future consumer only.

## Session And Branch Boundary

Begin the hunt in a new coordinator session after this plan is committed. If
that session will write the integrated audit or dossier corrections, create a
dedicated research branch from the committed baseline:

```sh
git switch -c research/provider-capability-latency-audit
```

The research branch may change `.plans/` and evidence-backed
`.docs/provider-dossiers/` material. It must not modify production behavior,
tests, or fixtures until the integrated audit has been reviewed and a separate
implementation slice is approved.

## Current Baseline

Read these before any provider-specific investigation:

- `AGENTS.md`
- `.docs/providers.md`
- `.docs/provider-intake.md`
- `.docs/provider-agent-workflow.md`
- `.docs/playback-source-inventory-contract.md`
- `.docs/poster-image-rendering.md`
- `.docs/diagnostics-guide.md`
- `.docs/playback-timing-and-aniskip.md`
- `.plans/provider-hardening.md`
- `.plans/provider-engine-behavior-audit.md`
- `.plans/provider-engine-behavior-implementation.md`
- `.plans/plan-implementation-truth.md`
- `apps/experiments/README.md`
- `apps/experiments/scratchpads/README.md`

Read the active provider and runtime code:

- `packages/providers/src/vidking/direct.ts`
- `packages/providers/src/rivestream/direct.ts`
- `packages/providers/src/miruro/direct.ts`
- `packages/providers/src/allmanga/direct.ts`
- `packages/providers/src/allmanga/api-client.ts`
- `packages/providers/src/shared/source-inventory.ts`
- `packages/providers/src/shared/provider-cycle.ts`
- `apps/cli/src/services/playback/PlaybackResolveService.ts`
- `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- `apps/cli/src/services/playback/PlaybackResolveWorkService.ts`
- `apps/cli/src/services/playback/ResolveWorkLedger.ts`
- `apps/cli/src/services/playback/PlaybackSourceInventoryProjection.ts`
- `apps/cli/src/services/playback/SourceInventoryService.ts`
- `apps/cli/src/services/playback/StreamHealthService.ts`
- `apps/cli/src/app/source-quality.ts`
- `apps/cli/src/app/episode-prefetch.ts`

Provider research sources:

- `.docs/provider-dossiers/vidking.md`
- `.docs/provider-dossiers/rivestream.md`
- `.docs/provider-dossiers/miruro.md`
- `.docs/provider-dossiers/allmanga.md`
- `.docs/provider-dossiers/usage-matrix.md`
- `apps/experiments/scratchpads/provider-vidking/`
- `apps/experiments/scratchpads/provider-rivestream/`
- `apps/experiments/scratchpads/provider-miruro/`
- `packages/providers/test/fixtures/`

## Known Live-Smoke Evidence

An approval-gated manual provider smoke was performed on 2026-05-25:

| Provider   | Result                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| VidKing    | Resolved a playable stream successfully.                               |
| Rivestream | Resolved a playable stream successfully.                               |
| AllManga   | Resolved a playable stream successfully.                               |
| Miruro     | Pipe request failed from this environment as classified network error. |

This evidence does not prove Miruro is globally unavailable. It proves that the
Miruro pipe endpoint was not reachable for the tested environment at that time.
Do not repeat this smoke routinely.

## Research Questions

The coordinator must answer these before proposing code changes:

1. Which useful provider facts are already present in a response or fixture but
   are not retained through normalized inventory, storage, mpv handoff, UI, or
   diagnostics?
2. Which requested rich facts require an additional upstream request, and is
   that request blocking, near-need, background, or manual-diagnostic work?
3. For one foreground playback intent, what provider/catalog/manifest/health
   calls can occur on cache hit, inventory hit, cold resolve, fallback,
   recovery, and prefetch handoff paths?
4. Which provider-local loops can multiply calls before global fallback, and
   which are bounded or health-aware today?
5. Can posters, episode artwork, seek thumbnails, timing hints, subtitles,
   quality choices, audio choices, and external IDs be made richer using facts
   already returned?
6. Which provider-specific improvements belong in shared helpers, and which
   must remain provider-native to avoid flattening real semantics?
7. Which recommendations can be proven by deterministic fixtures and call-count
   tests before any new live validation?

## Work Decomposition

### Phase 1: Coordinator Offline Baseline

The coordinator performs this phase alone, without subagents or live calls.

Outputs:

- one current architecture and call-path map
- one capability taxonomy used by every provider report
- one request-cost rubric
- one contradiction list for stale dossier or plan claims
- one assignment packet for each provider agent

The baseline must identify which questions are already answered by production
code, fixtures, or existing experiment notes. Provider agents should not be
assigned solved questions.

### Phase 2: Parallel Provider Evidence Pass

After Phase 1 defines the shared rubric, dispatch at most one research agent
per independent active provider:

| Agent | Scope               | Allowed initial activity                                        |
| ----- | ------------------- | --------------------------------------------------------------- |
| A     | VidKing             | Read code, fixtures, dossier, scratchpad reports; report only   |
| B     | Rivestream          | Read code, fixtures, dossier, scratchpad reports; report only   |
| C     | Miruro              | Read code, fixtures, dossier, scratchpad reports; report only   |
| D     | AllManga / AllAnime | Read code, fixtures, dossier, ani-cli parity notes; report only |

Provider agents must not edit common docs, production code, or shared fixtures.
They return findings to the coordinator. The coordinator alone writes the
integrated report and any approved dossier corrections so evidence does not
conflict.

### Phase 3: Integration And Prioritization

The coordinator merges reports against runtime contracts and classifies every
finding:

| Action class             | Meaning                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| Preserve now             | Data is already received; retaining/projecting it costs no extra request.    |
| Cache or join            | Work is valid but currently duplicated or insufficiently reused.             |
| Defer behind user action | Richness needs extra provider work and must not affect passive UI latency.   |
| Verify manually          | Code/docs/fixtures cannot prove the behavior; pinned approved smoke needed.  |
| Reject                   | Capability is speculative, too costly, privacy-risky, or violates contracts. |

### Phase 4: Optional Approved Manual Evidence

This phase is not automatically authorized by this plan.

If an unresolved high-value finding needs live evidence, the coordinator asks
for approval before executing it and states:

- provider
- pinned title and episode fixture
- exact capability being verified
- expected request budget
- what implementation decision the result would unblock
- redaction/storage policy for the resulting evidence

Run only the approved targeted check. Do not fan out across all providers as a
routine revalidation.

## Capability And Request-Cost Matrix

Every provider report must use this table:

| Capability                      | Available evidence | Preserved today | User surface using it | Extra calls needed | Budget lane if fetched | Recommendation | Confidence |
| ------------------------------- | ------------------ | --------------- | --------------------- | ------------------ | ---------------------- | -------------- | ---------- |
| Source/mirror inventory         |                    |                 |                       |                    |                        |                |            |
| Quality variants                |                    |                 |                       |                    |                        |                |            |
| Audio/sub/dub facts             |                    |                 |                       |                    |                        |                |            |
| Soft subtitle inventory         |                    |                 |                       |                    |                        |                |            |
| Hardsub facts                   |                    |                 |                       |                    |                        |                |            |
| Poster/backdrop/episode artwork |                    |                 |                       |                    |                        |                |            |
| Seek-bar thumbnails             |                    |                 |                       |                    |                        |                |            |
| Intro/outro/timing facts        |                    |                 |                       |                    |                        |                |            |
| External/catalog IDs            |                    |                 |                       |                    |                        |                |            |
| Expiry/header requirements      |                    |                 |                       |                    |                        |                |            |
| Failure/health evidence         |                    |                 |                       |                    |                        |                |            |

Confidence must be one of:

- `Known`: backed by code, fixture, or approved direct evidence.
- `Suspected`: suggested by reports or code shape but not proven.
- `Unknown`: no reliable evidence yet.

## Playback Request-Economy Matrix

The integrated report must enumerate expected work for these paths:

| Scenario                          | Stream cache checks | Inventory checks | Health probes | Provider resolves | Catalog requests | Manifest requests | Expected optimization |
| --------------------------------- | ------------------- | ---------------- | ------------- | ----------------- | ---------------- | ----------------- | --------------------- |
| Fresh exact cache hit             |                     |                  |               |                   |                  |                   |                       |
| Cached inventory selection        |                     |                  |               |                   |                  |                   |                       |
| Cold foreground resolve           |                     |                  |               |                   |                  |                   |                       |
| Provider-local source retry       |                     |                  |               |                   |                  |                   |                       |
| Global provider fallback          |                     |                  |               |                   |                  |                   |                       |
| Near-EOF prefetch plus handoff    |                     |                  |               |                   |                  |                   |                       |
| Recovery after dead stream        |                     |                  |               |                   |                  |                   |                       |
| Quality/source/subtitle selection |                     |                  |               |                   |                  |                   |                       |
| Download re-resolve               |                     |                  |               |                   |                  |                   |                       |

For each non-zero call, identify its reason and budget lane. Flag any call that
would occur because of rendering, list movement, focus change, or unconfirmed
picker navigation.

## Required Deliverables

The new coordinator session must produce:

1. An integrated provider capability and request-cost audit.
2. A provider-by-provider matrix covering preserved, discarded, and expensive
   facts.
3. A resolver latency map for cache, inventory, cold, retry, fallback,
   prefetch, recovery, selection, and download paths.
4. A redundant-request risk list with exact owners and deterministic test seams.
5. A richness opportunity list for posters, episode art, seek thumbnails,
   timing, audio/subtitle/source controls, and diagnostics.
6. A list of stale or unsupported dossier claims that require correction or
   approved verification.
7. Prioritized implementation slices, each identifying expected latency/user
   value, owning files, tests, and whether live confirmation is needed.
8. Paste-ready implementation prompts only after the audit is reviewed.

Recommended output path:

- `.plans/provider-capability-latency-audit.md`

Provider dossier corrections, if justified by deterministic evidence, belong in:

- `.docs/provider-dossiers/<provider-id>.md`

## Coordinator Session Prompt

Use the following as the initial prompt in a new session:

```text
We are in /home/kitsunekode/Projects/hacking/kitsunesnipe.

Goal: run the provider capability and latency research hunt described in
.plans/provider-capability-latency-research-hunt.md. This is research and
design only. Do not implement production behavior.

Start from the committed baseline. If you are writing audit/dossier artifacts,
work on branch research/provider-capability-latency-audit.

Read first:
- AGENTS.md
- .plans/provider-capability-latency-research-hunt.md
- .plans/provider-engine-behavior-audit.md
- .plans/provider-engine-behavior-implementation.md
- .plans/plan-implementation-truth.md
- .docs/provider-agent-workflow.md
- .docs/provider-intake.md
- .docs/playback-source-inventory-contract.md
- .docs/poster-image-rendering.md
- apps/experiments/README.md

Rules:
- Code and deterministic fixtures are truth when docs drift.
- Offline/code/fixture/dossier audit first.
- No routine live provider calls.
- Do not run any live experiment or provider smoke without asking first with
  provider, pinned fixture, request budget, and decision it would unblock.
- Do not change production code.
- Do not implement remote telemetry, health aggregation, or Cloudflare work.
- Redact token-bearing URLs, cookies, auth-like headers, subtitle URLs, and
  local paths from durable documentation.
- Keep playable truth, catalog truth, presentation hints, and diagnostics
  evidence separate.
- Identify both richer available data and the network cost of obtaining it.

Work in this order:
1. Build the shared offline rubric and map current production request paths.
2. Decide which provider investigations are truly independent.
3. Dispatch read-only provider research agents only after the shared rubric is
   fixed.
4. Integrate findings into .plans/provider-capability-latency-audit.md.
5. End with prioritized implementation slices and unresolved approval-gated
   evidence checks.

Deliverables:
- current capability and request-economy matrix
- retained vs discarded rich-data inventory per active provider
- latency/redundant-call risk map
- poster/artwork/seek-thumbnail/timing/subtitle/audio/source opportunity map
- stale dossier correction list
- scoped implementation slices with deterministic tests
- explicit list of any proposed live checks requiring my approval
```

## Provider Agent Assignment Template

The coordinator may instantiate one copy of this prompt per provider after
Phase 1:

```text
Research only: audit <PROVIDER> against the coordinator rubric.

Allowed sources:
- packages/providers/src/<provider>/
- packages/providers/test/fixtures/<provider>/
- .docs/provider-dossiers/<provider>.md
- relevant apps/experiments/scratchpads/provider-<provider>/ reports
- shared contracts named by the coordinator

Do not:
- modify production code or shared docs
- run live provider requests
- assume dossier claims are current without code or fixture evidence
- expose raw token-bearing URLs, cookies, or auth-like headers

Return:
1. Known, Suspected, and Unknown findings.
2. Completed capability and request-cost matrix rows.
3. Facts already returned but not preserved or consumed.
4. Additional calls required for any proposed richness.
5. Provider-local retry/cycling latency and redundancy risks.
6. Exact deterministic fixture/test opportunities.
7. Questions that genuinely require a separately approved pinned live check.
```

## Decision Gates After Research

Do not begin implementation until the user has reviewed:

- the integrated audit
- recommended provider dossier corrections
- any proposed approved live checks
- ordered implementation slices

The expected first implementation wins should prefer:

1. preserving useful facts already received at zero additional request cost;
2. eliminating duplicated work proven by request-count tests;
3. deferring expensive richness behind explicit actions and caches;
4. using targeted live validation only for decisions fixtures cannot prove.
