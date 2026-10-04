# Verification loop and onboarding repairs

Date: 2026-10-04. Candidate base: PR #562 at
20fa74725726ec0d4649b7dc280efa4e3a183a32. The file-vault test isolation commit
from PR #561 is ported before these changes; review automation configuration
from that PR is not included. This is local Linux evidence, not a merge,
release, current-main signoff or physical-phone qualification.

## Confirmed repairs

- Held CLI `--command --offline` was rejected as an unknown harness flag;
  a missing value was silently accepted. The subprocess regression failed
  before repair and now enters the real offline Library and passes doctor.
- Startup waited on the brand word rather than an interactive screen. The
  readiness predicate accepts visible setup/browse/search/library chrome with
  key hints and rejects brand-only output. Doctor additionally checks pane
  liveness, contained storage and file credentials, and consent/install-ID state.
- Shell double quotes executed command substitution in an environment value.
  A harmless owned temporary marker reproduced it. Literal paths/environment
  values now use POSIX argument quoting; storage/vault overrides are rejected
  before launch. Extra CLI arguments remain a trusted developer shell fragment.
- Failed interactive startup captures evidence outside the shadow profile,
  stops the created session and removes its sidecar. Stop refuses unexpected
  deletion before killing a session; a retained caller-owned profile can stop.
- Setup used terminal columns inside a padded root. Real 80x24 captures showed
  wrapped divider cells. The rendered regression failed at 72/80/100/140;
  shared root padding is now deducted from frame and content budgets. All 21
  setup captures include the padded parent rather than an isolated full-width
  setup. Real 80x24 setup re-entry confirmed the dividers fit.

## Real CLI evidence

Evidence root: /tmp/kunai-verification-loop-20261004. Reports contain only
throwaway profile/fixture state and remain outside deleted session directories.

| Report | Frame witness | Committed witness |
| --- | --- | --- |
| onboarding-defaults-backend | Browse after skipped remaining defaults | analytics unset; installId empty |
| onboarding-width-after | setup 1/7; two intact 78-column dividers at 80x24 | analytics unset; installId empty |
| queue-added | Added Smoke Movie to Up Next | tmdb:smoke-movie-1 pending |
| queue-restored | Smoke Movie labeled up next after explicit restore | same queue identity pending |
| queue-removed | Nothing queued | queue empty |

The queue session was stopped and its profile removed after reports. Fresh and
offline baseline sessions were stopped; their explicitly retained temporary
profiles were kept for inspection. Other pre-existing tmux sessions were left
alone. A test-isolation mistake briefly allowed a native override during an
initial rejection test; the exact test session was stopped, the guard now runs
before launch, and rejection coverage uses harmless storage-root input or a
non-launched sidecar. No qualification claim relies on that failed run.

## Checks

Fresh full workspace: 8,140 pass, 60 skip, zero fail; 26 tasks, zero cached.
Final agent tier: 22 pass, one skip (opt-in real mpv), zero fail.
Fresh typecheck: 15 tasks; lint: 14 tasks with zero errors (existing warnings
remain); full build: 10 tasks. Formatting, document paths and skill validation
passed. Agent tests are a separate tier from default unit/integration.

React Doctor 0.9.14 was resolved by the latest command, with telemetry and score
submission disabled. Against the exact parent it reported zero new errors and
one warning/fixed-warning pair for AppRoot's changed fingerprint. A separate
parent scan confirmed identical cyclomatic 30, cognitive 35 and nesting 4:
this change does not reduce that existing complexity debt. The parent full
scan has other pre-existing diagnostics; this is not a clean-codebase claim.

## Still open

A combined `/setup` + Enter input burst reached History in the real CLI;
separated palette/query/submit inputs reached setup. This needs a controlled
paste/fast-input reproduction and handler diagnosis; slower successful input
is not a product fix. The 100x30 fixture result companion also showed
compressed/overlapping metadata; rendered fixtures need investigation before
calling that preview usable. Neither observation was mass-refactored here.

The corrected verification skill describes the explicit queue restore route
and focus-aware palette navigation. Its pstack-inspired coverage requires
source plus UI/backend witnesses, reverse cases, a healthy owned session and
cleanup preserving evidence; it does not require per-feature subagents.

The existing queue/phone plan contains the local companion proposal: shared
application services, framework-independent local API, bundled touch UI and
both destinations. No companion server/UI, native app, provider request-profile
parity, physical phone playback or store artifact is implemented by this PR.
