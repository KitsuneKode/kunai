# Provider Source Reliability for 0.3.0

Status: DESIGN APPROVED — IMPLEMENTATION PLAN READY

Owner: provider runtime

Last updated: 2026-08-24

## Objective

Ship the current AniDB source-inventory and AllManga restoration work as a
reliable part of the still-unreleased Kunai 0.3.0 release. The change must keep
the selected source responsive, expose alternate audio sources only when they
are real, preserve useful failure evidence, and retain a safe manual path for
testing a user-configured relay.

This is a hardening change, not a version bump. It must not create a 0.3.1
changeset or change package versions.

## Evidence behind the design

The uncommitted implementation was reviewed against the production provider
bootstrap, candidate planner, source inventory contract, provider docs, release
artifacts, and deterministic tests.

Current baseline:

- `bun run test --filter=@kunai/providers --filter=@kunai/config` passes: 408
  provider tests and 6 config tests.
- `bun run test:live:anidb` succeeds through the production engine with two
  streams in about 3.6 seconds.
- `bun run test:live:allanime` succeeds through the production engine with four
  streams in about 12.3 seconds.
- AllManga's cold live result is therefore functional but too close to the
  balanced provider-attempt deadline to call latency safe.

The review also established these correctness gaps:

- AniDB currently treats every non-English language as subtitled Japanese.
- AniDB waits for every language request, so an irrelevant slow language can
  hold the requested source at the attempt deadline.
- Alternate-language failures are discarded, and a missing requested mode is
  reported as retryable even when the language catalog proves it unavailable.
- The AllManga crypto tests derive their expected value from the implementation
  under test instead of using independent build-140 known answers.
- `animeProviderPriority` is an ordering preference, not an allowlist. Adding
  AllManga to the default after AniDB does not activate a new lane, and leaving
  Miruro out does not make it manual-only.
- The pending changeset would describe a post-release patch, but these changes
  belong in the unreleased 0.3.0 artifacts.

## Chosen design

### 1. AniDB resolves the requested mode first

AniDB will normalize the language catalog into at most two recognized lanes:

| AniDB code | Kunai mode |
| ---------- | ---------- |
| `jpn`      | `sub`      |
| `eng`      | `dub`      |

Other language codes are ignored until Kunai has a product-level way to expose
them honestly. They must never be relabeled as Japanese subtitle sources.

The requested mode is foreground work. Its request keeps the provider
attempt's cancellation signal and full deadline. The resolver must never
silently replace it with another audio mode.

If the catalog proves the requested mode absent, the provider returns a typed,
non-retryable unavailable result. Network, parse, and upstream failures remain
retryable according to the existing provider error policy.

### 2. Alternate source discovery has a bounded budget

When both recognized modes exist, the alternate mode may begin concurrently,
but it receives only the startup-profile inventory budget:

- fast: skip alternate discovery on the playback-critical path;
- balanced: wait at most 1 second after the requested mode is ready;
- quality-first: wait at most 4 seconds after the requested mode is ready.

The exact constants should reuse the existing startup-selection budgets rather
than introduce a second set of magic numbers. A timeout aborts only the
alternate request. It must not extend the selected provider attempt or leave an
unowned request running.

The AniDB client will return structured per-mode outcomes rather than only a
flat list. Outcomes distinguish resolved, catalog-unavailable, failed, and
timed-out work. The direct provider maps those outcomes into source inventory
and diagnostic trace entries:

- a resolved mode is selectable and contains its real streams;
- a failed or timed-out alternate is either omitted or shown disabled with a
  concise reason, following the existing source-inventory contract;
- no mode is advertised as selectable without streams;
- alternate failures remain visible in debug diagnostics without invalidating
  a successful requested source.

Episode and language metadata should be fetched and normalized once per
resolve. The direct provider and client must not maintain duplicate mappings or
repeat the same catalog work merely because the cache makes it cheap.

### 3. AllManga build-140 parity gets independent regression vectors

The build-140 decoder and request-signing constants remain aligned with the
ani-cli reference behavior already recorded in the provider docs. Tests will
use fixed known inputs and outputs for:

- the build-140 token or boot material;
- each mask or decoder transformation changed by this work;
- the final request key or signed request fixture;
- required request headers and the 140 endpoint contract.

Expected values must be literals produced independently from the implementation
under test. The existing live smoke remains the proof that current upstream
behavior works; deterministic fixtures are the guard against local regression.

The cold path will receive timing evidence around bootstrap and source fetch.
This PR will not raise global attempt timeouts to hide latency. Any optimization
must remove or overlap a measured serial wait, preserve cancellation, and have
a deterministic regression test. The PR report will include fresh isolated
live timings even if upstream variance prevents a strict wall-clock assertion.

### 4. Provider priority remains truthful

This PR will not turn `animeProviderPriority` into an allowlist. That would
change provider recovery semantics and is outside this reliability fix.

The no-op default/config-test edits that claim to activate AllManga will be
removed. Provider manifests and docs will describe the actual behavior:
configured names are tried first, while other compatible production providers
remain eligible. Claims that Miruro is manual-only will be removed unless a
real runtime restriction exists.

### 5. Keep a safe real-config relay diagnostic wrapper

`bun run test:relay` remains an explicitly manual diagnostic, not a default CI
or deterministic-test gate. Its purpose is to reproduce failures with the
relay settings a user actually configured while keeping the child smoke
isolated from user data.

The wrapper contract is:

- read only `providerRelay` from the platform-resolved real config path;
- never modify the real config, data database, cache database, or tokens;
- let explicit `KUNAI_RELAY_*` environment variables override config values;
- validate that the selected base URL uses `http:` or `https:` and reject
  embedded URL credentials;
- never print a token, query string, fragment, or full credential-bearing URL;
- report whether values came from environment or config, a safely redacted
  origin/host, whether a token is present, and the child smoke result;
- launch the existing relay AllManga smoke with a cross-platform filesystem
  path and a fresh isolated XDG profile;
- clean up the child profile on success, failure, signal, or timeout;
- state clearly when the isolated smoke forces AllManga for diagnosis instead
  of implying that the user's provider preferences were changed.

Configuration resolution and validation will be extracted into a pure helper.
Deterministic tests pass synthetic config and environment values to that helper;
they never read the developer's real profile. Coverage includes precedence,
missing values, invalid schemes, embedded credentials, redaction, and
cross-platform child-script path resolution.

This wrapper tests metadata relay behavior only. It does not enable a shared
public relay, change `videoFallback`, or widen the production relay contract.

### 6. Fold the work into unreleased 0.3.0

Implementation will:

- remove the pending patch changeset for this work;
- update the package and root changelogs under their existing unreleased 0.3.0
  sections;
- update `.release/kunai-v0.3.0.md` so its provider checklist and evidence
  include AniDB source inventory, AllManga build 140, and the optional relay
  diagnostic;
- regenerate derived docs metadata using the repository generator;
- leave every package version unchanged.

Provider documentation will be edited narrowly: remove contradictory build-81
and manual-only claims, document build-140 parity, describe source-inventory
behavior, and label the real-config relay command as an opt-in read-only
diagnostic.

## Error, cancellation, and privacy rules

- Selected-source success is never invalidated solely by an alternate failure.
- A caller abort cancels all AniDB work owned by that resolve.
- An alternate deadline cancels only alternate work and is always cleared.
- No promise is intentionally left running after a resolve returns.
- Errors identify provider, stage, and mode without logging stream URLs,
  relay tokens, signed query strings, or other credentials.
- The real-config relay wrapper reads the minimum configuration surface and
  does not persist normalized or derived values.

## Test and verification matrix

Implementation starts with failing focused tests for the bugs above, then runs:

```sh
bun run test --filter=@kunai/providers --filter=@kunai/config
bun run test
bun run typecheck
bun run lint
bun run fmt
bun run verify:doc-paths
bun run build
bun run changeset status
```

Required focused cases:

- AniDB Japanese-only, English-only, dual-mode, and unknown-language catalogs;
- requested mode absent versus requested mode upstream failure;
- slow, rejected, and timed-out alternate work without selected-mode delay;
- caller cancellation and no post-return alternate work;
- fixed AllManga build-140 crypto and header vectors;
- relay env-over-config precedence, validation, redaction, and isolated launch;
- provider-priority tests that assert ordering semantics rather than allowlist
  semantics.

After deterministic gates pass, run the production engine smokes in isolated
profiles and record timings:

```sh
bun run test:live:anidb
bun run test:live:allanime
bun run test:relay
```

`test:relay` is required only when valid user-owned relay configuration or
explicit relay environment values are available. A missing relay configuration
must produce a clear skip, not a false success or a destructive setup step.

## Scope boundaries

In scope:

- AniDB client/direct source-inventory correctness and focused tests;
- AllManga build-140 parity tests and measured cold-path hardening;
- the real-config relay diagnostic wrapper and deterministic helper tests;
- provider truth docs and unreleased 0.3.0 release artifacts.

Out of scope:

- a true provider allowlist or provider-planner redesign;
- new providers or broad provider ranking changes;
- video relay enablement or a Kunai-hosted public relay;
- unrelated open-PR ordering or merge-stack analysis;
- package version changes or publishing 0.3.0.

## Delivery

Work lives on `fix/provider-source-reliability-0.3.0`. The implementation will
be split into reviewable commits for provider logic/tests, relay diagnostics,
and release/docs truth where practical. Before the PR is opened, the branch
must pass the full deterministic gate, fresh live provider checks must be
reported separately from deterministic evidence, and the diff must be reviewed
against `main` for unrelated growth.

When this plan's core merges, move it to `.archive/plans/` and remove its active
roadmap row in the same change set.
