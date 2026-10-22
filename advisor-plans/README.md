# Advisor plans — 2026-10-09 codebase audit (+ 2026-10-19 re-audit)

Handoff plans produced by codebase audits. Executed by other agents; each plan
is self-contained (paths, excerpts, commands, STOP conditions) and needs no
session context.

**2026-10-19 re-audit.** This checkout (`faf1afd22`) is now **366 commits
behind `origin/main`, 0 ahead** — a strict ancestor. Upstream landed the
Gate-0 integration and most Phase-1 register rows; what remains open on main is
tracked in `.plans/2026-10-08-release-readiness.md` (on main). Two new
provider-side findings were filed as plans 007–008; everything else verified in
this run is owned by an existing register (see Reconciliation below).

**Why `advisor-plans/` and not `.plans/`**: `.plans/` is the repo's own
roadmap-gated plan system — `AGENTS.md` and `bun run verify:doc-paths` enforce
that every `.plans/*.md` is indexed by `.plans/roadmap.md`. These advisor
plans are external handoffs, not roadmap work, so they live here to keep
`verify:doc-paths` green and avoid polluting the roadmap.

## Status

| Plan                                                                      | Priority | Effort | Risk   | Status                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | -------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001 commit-safety batch](./001-commit-safety-batch.md)                   | P1       | S      | LOW    | not started                                                                                                                                                                                |
| [002 workflow input binding](./002-workflow-input-binding.md)             | P1       | S      | LOW    | not started                                                                                                                                                                                |
| [003 probe-cap accounting](./003-probe-cap-accounting.md)                 | P2       | S      | LOW    | not started                                                                                                                                                                                |
| [004 attention wire-or-retire (spike)](./004-attention-layer-decision.md) | P2       | S      | LOW    | not started — blocked on maintainer decision                                                                                                                                               |
| [005 test-truth batch](./005-test-truth-batch.md)                         | P2       | M      | LOW    | not started                                                                                                                                                                                |
| [006 worktree hygiene](./006-worktree-hygiene.md)                         | P2       | S      | MEDIUM | not started — added 2026-10-10 re-audit                                                                                                                                                    |
| [007 allmanga crypto rotation](./007-allmanga-crypto-rotation.md)         | P1       | M      | LOW    | ✅ done 2026-10-19 — build-181 profile landed + live-verified (`bootstrapStatus: 200`, `epochsBehind: 0`); streams still captcha-gated on datacenter egress (documented upstream behavior) |
| [008 status sweep truth](./008-provider-status-sweep-truth.md)            | P2       | S–M    | LOW    | not started                                                                                                                                                                                |
| [009 unowned audit residuals](./009-unowned-audit-residuals.md)           | P2       | S–M    | LOW    | not started — added 2026-10-19 third-party-review verification; item 5 (palette keystroke bleed) is the live-bug payload                                                                   |

## Reconciliation — 2026-10-10 re-audit

A follow-up audit ran at the same commit (`faf1afd22`). Gates re-verified
uncached: `typecheck` ✅ 15/15, `lint` ✅ 0 errors, `test:unit` ✅ 5846
pass / 1 skip / 1 fail (same known WIP `tokens.ts` failure), `test:integration`
✅ 296 pass / 25 skip / 0 fail, docs test ❌ 1 fail (same token-drift WIP).

New findings were limited to environment/hygiene: the root `node_modules`
store had dangling symlinks (`turbo@2.11.5`, `typescript@7.0.2`) that made
every gate command fail with `turbo: command not found` — repaired by
`bun install --frozen-lockfile` (no lockfile change); **61 git worktrees
totaling ~31 GB** (plan 006); the live `<<<<<<< HEAD` marker at
`.docs/repo-infrastructure.md:154` and `packages/storage/undefined/` are
still present on this branch and already owned (A17 / plan 001). All
code-level findings remain owned by `.docs/research/audit-4-2026-10-07.md`,
`.plans/2026-10-08-release-readiness.md`, and plans 001–005 — no duplicates
filed.

Recommended execution order = numbering (001 → 005). 001 first: it makes the
tree safe to commit and un-reds the `verify:doc-frontmatter` gate. 004 is a
spike — its deliverable is a decision memo back to the operator, not code.

## Reconciliation — 2026-10-19 re-audit (vs origin/main @ 2f2537e2f)

Verified directly against `origin/main` (not assumed):

- **Fixed upstream:** A02 (watchdog `coreIdle` gate), A03/A06 reconnect
  generation checks, A05 (AniList validates before persist), A07 (relay roster,
  #599 + dedupe), A17 (conflict marker gone on main — still live in _this_
  checkout at `.docs/repo-infrastructure.md:154`), A20 (`listDueQueued`),
  PM-01 (`${binPath}.old` only, `$bunfs`-gated), B6/`#462` (bare `"dns"`
  pattern gone), plus every audit-3 issue sampled (#447–#452, #456, #466, #468)
  is CLOSED.
- **Still live on main:** ASYNC-3 (`end-file stop` → quit mid-reconnect;
  `mapMpvEndReason` unchanged, `handlePlaybackEnded` clears the pending
  reconnect and resolves), A19 (`listTitleAssets` default `limit=100` still
  feeds `findReadyJobIdForEpisode`/`isEpisodeDownloaded`), SI-01
  (`playback_events` insert-only), SI-04 rest (bare `JSON.parse` at
  `title-provider-health.ts:37`, `sync-reconciliation.ts:206`), PN-02 (miruro
  `isRelayedResponse` — 0 refs; only hianime/anidb honor the marker),
  PROV-2 (allmanga `deferredLocator` branch skips `verifyCandidateStream`;
  coverage test is still grep-only), UX-01 residual (`void
downloadService.abort(...)` at `download-manager-shell.tsx:384` et al.
  under the still-fatal `unhandledRejection`).
- **Owned elsewhere, not re-planned:** release-readiness Phase 1/2 rows
  (`.plans/2026-10-08-release-readiness.md` on main), audit-4 register
  (`.docs/research/audit-4-2026-10-07.md`), open issues #422 (provider outage
  tracking), #472 (anti-slop ratchet ungated, 5,427 errors), #267, #195, #666
  (IntroDB v2/v3 retirement → v4 migration), #480 (DoH fallback).
- **New findings this run → plans 007–008** (allmanga crypto rotation verified
  live; status-board misreporting verified by residential-network sweep).
- **Not bugs, verified as deliberate:** videasy kept loaded-but-dead per
  dossier verdict (resurrection slot; `db.wingsdatabase.com` catalog mirror
  answers 200 — the operator resurfaced, stream hosts remain NXDOMAIN/502);
  `rgshows`/`cineby` in `src/` are intake-stage research modules, not
  production; `.husky/_/.gitignore` diff is husky self-regen.
- **Working tree:** unchanged since the 10-10 re-audit — `tokens.ts` WIP still
  fails its 2 tests, `packages/storage/undefined/` still present (plan 001),
  `.plans/2026-*` audit packets still untracked.

## Reconciliation — 2026-10-19 third-party review verification

A pasted external audit (reviewed this checkout `faf1afd22`) was re-verified
finding-by-finding against `origin/main` by direct code reads plus three
independent read-only agents. About a third of its claims were the classic
failure mode from `.docs/agents/audit-findings-bar.md` — true about a line,
wrong about what it does.

- **Refuted (recorded in plan 009 so nobody re-files):** `""`-host poisoning
  in resolve-gate (guarded by `if (host)`), watchdog `coreIdle` (fixed on
  main), reconnect-state-never-reset (`resetCycleState()` runs on every
  `play()`), kickassanime "unprobed" manifest (the fetch IS the probe), relay
  `hostMatches` suffix attack (dot-boundary is safe), one-shot mpv preflight
  killing materialized local streams (fixed on main via
  `needsMpvNetworkPreflight`), `storage/undefined/` as a code bug (stray
  `bun -e` artifact, not a path-resolution defect).
- **Confirmed live on main but already owned:** every pasted storage/UX/async
  finding maps to an existing register row — DATA-1/2, Fence, SI-01…SI-10,
  SI-03/SI-04 rest, SI-07+DATA-8, ASYNC-1/3, ST1, A05, A19, PN-02, PROV-2,
  Sanitizer sinks, UX-03, fatal-rejection void sites, `post-playback` scope
  typo — see `.plans/2026-10-08-release-readiness.md` on main.
- **Confirmed live on main and previously unowned → plan 009:** redaction
  `SENSITIVE_KEYS` gaps, `isExpired` fail-open on corrupt `expires_at`, four
  per-entity insert-only tables needing a retention decision,
  `VIDEOSY_PROVIDER_ID` typo, and **command-palette keystroke bleed into the
  downloads/library overlays** (`root-overlay-shell.tsx:2233-2277` mounts both
  the overlay's `useInput` and the palette; `x`/`r`/`Esc`/letters reach both —
  the register's "`/` capture" row names only the history-overlay sibling).
- **Corrections recorded by verification:** ST1 is **fixed on main** —
  `ConfigServiceImpl.recordAnalyticsPing` re-checks consent+identity under the
  lock before writing bookkeeping (`ConfigServiceImpl.ts:436-478`), so #655 is
  the remaining settings-pane direction, not a sibling of an open bug. The
  "Fatal rejections" register row under-enumerates — ~19 verified rejectable
  `void` sites (playerControl hotkey paths, `dispatchAppCommand` IIFE, stats
  export/genres, offline-library `retry`, `DebugTraceReporter` prune) vs the
  ~7 listed, and its `SettingsShell.tsx:139,155,187` cite is stale (`saveDraft`
  catches now). `post-playback` scope typo exists but the whole
  `resolveSurfaceTitleControlInput` module is dead code (zero callers) —
  Phase-3 cleanup already names it.

### Open-PR coverage matrix (authoritative `gh` state, 2026-10-19)

| PR                                                   | State           | Covers                                                                                                                                                                                       | Verdict                                                                                                                                                     |
| ---------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #652                                                 | OPEN            | download queue claiming/shutdown/storage-errors/retries (Fence slice)                                                                                                                        | FIXES its slice — does **not** cover DATA-1 publish marker, DATA-2 `deleteJob`, SI-07 `UPDATE OR REPLACE`, `.part` cleanup, or the `void abort` call-site   |
| #658                                                 | OPEN            | A19 `listTitleAssets` LIMIT 100                                                                                                                                                              | FIXES — diff verified (unbounded default for authority readers)                                                                                             |
| #657                                                 | OPEN            | stream credential origin scoping                                                                                                                                                             | FIXES (main already has per-candidate origin allowlist; PR narrows it)                                                                                      |
| #660                                                 | OPEN            | credential-store probe selection                                                                                                                                                             | FIXES                                                                                                                                                       |
| #661                                                 | OPEN            | Vidlink 10 s `Retry-After` clamp                                                                                                                                                             | FIXES                                                                                                                                                       |
| #662                                                 | OPEN            | resume lost on duration-only EOF                                                                                                                                                             | FIXES                                                                                                                                                       |
| #665                                                 | OPEN            | selected-cache clear + healthy fallback                                                                                                                                                      | FIXES                                                                                                                                                       |
| #663                                                 | OPEN            | shell readiness signal                                                                                                                                                                       | FIXES                                                                                                                                                       |
| #664                                                 | OPEN            | build measurement                                                                                                                                                                            | PARTIAL — bundles a subtitle-dedup functional fix inside an instrumentation PR                                                                              |
| #659                                                 | OPEN            | poster disk-cache limits                                                                                                                                                                     | FIXES                                                                                                                                                       |
| #655                                                 | OPEN            | passive Settings save wiping withdrawn analytics consent                                                                                                                                     | FIXES the remaining half — ST1's ping-completion re-read is already fixed on main (`ConfigServiceImpl.ts:436-478`); this closes the settings-pane direction |
| #639                                                 | OPEN            | audit fixes: header-drop diagnostics, StateBlock bounds, tone maps, doc drift                                                                                                                | FIXES its named scope                                                                                                                                       |
| #635                                                 | OPEN            | Movy ladder-first roster + Vidrock header contract                                                                                                                                           | FIXES                                                                                                                                                       |
| #633                                                 | OPEN            | search/palette submits stale text                                                                                                                                                            | FIXES the submit-staleness half of ASYNC-1 — the generation-token dispatch race is a different mechanism, still open                                        |
| #644                                                 | OPEN            | provider settings UX                                                                                                                                                                         | FIXES                                                                                                                                                       |
| #636                                                 | OPEN            | provider manual switches                                                                                                                                                                     | FIXES                                                                                                                                                       |
| #637                                                 | OPEN            | YouTube playlist/channel fallback + extractor freshness                                                                                                                                      | FIXES                                                                                                                                                       |
| #634                                                 | OPEN            | honest bootstrap copy + terminal-safe detail                                                                                                                                                 | PARTIAL on Sanitizer sinks — does not touch the raw `<Text>` sites in `ink-shell.tsx:1602`, `loading-shell.tsx:732,752`, `library-title-detail.tsx:256`     |
| #623 / #622                                          | OPEN            | semantic mouse focus; mouse selection + bounded Up Next                                                                                                                                      | FIXES their scopes                                                                                                                                          |
| #645                                                 | OPEN            | live Movy mpv decode smoke                                                                                                                                                                   | test-only                                                                                                                                                   |
| #648 / #641                                          | OPEN            | torrent features                                                                                                                                                                             | feature PRs, unrelated to audit                                                                                                                             |
| #638                                                 | OPEN            | plugin trust docs                                                                                                                                                                            | docs, unrelated                                                                                                                                             |
| #612                                                 | OPEN            | ImgBot image optimization                                                                                                                                                                    | bot, unrelated                                                                                                                                              |
| #499                                                 | OPEN            | mobile docs honesty                                                                                                                                                                          | docs, unrelated                                                                                                                                             |
| #327                                                 | OPEN            | changesets version-packages                                                                                                                                                                  | perpetual bot PR                                                                                                                                            |
| #306                                                 | OPEN            | Chromecast                                                                                                                                                                                   | feature, unrelated                                                                                                                                          |
| #255                                                 | OPEN            | anti-slop chained-assertions refactor                                                                                                                                                        | owned register item (#472 class)                                                                                                                            |
| #599, #606, #602, #605, #654, #656, #649, #653, #643 | MERGED          | relay roster (A07), audit-batch2, terminal-escape + destructive confirms, KAA failure classes, perf batch, vault entry preservation, miruro harvest note, vidlink backoff, monotonic enqueue | landed on main — the corresponding audit claims are CLOSED                                                                                                  |
| #592                                                 | CLOSED unmerged | DATA-2 `DownloadDeleteResult`                                                                                                                                                                | **fix abandoned — DATA-2 has no live PR**                                                                                                                   |
| #573                                                 | CLOSED unmerged | status-transition fencing                                                                                                                                                                    | landed via #591 integration per the register; the unfenced-_mutation_ residue is the live "Fence" row                                                       |

### Register rows with NO open PR (the real backlog)

DATA-1 (publish marker), DATA-2 (`deleteJob` — #592 closed unmerged),
SI-07+DATA-8 (`relocateTitleId`), Fence residue (`markHeartbeat`/`updateProgress`
etc. — #652 does only queue claims), ASYNC-3+A03 (`end-file stop` race),
socket sweep, wedged downloads (`.part` cleanup + liveness kill), A05
(`persistToken` ordering), SI-05 (token file lane), Sanitizer sinks residual,
ASYNC-1 generation token (#633 covers submit staleness only), relay finality
PN-02 (Miruro `isRelayedResponse`), not-found health neutrality, SI-01/SI-10
insert-only growth, SI-04 rest (bare `JSON.parse`), fatal-rejection `void`
sites (UX-01 residual), UX-03 (`--flag=value` silently ignored — verified
`argv.indexOf("--to")` swallows `--to=v` on main), Miruro redirect vetting,
poster-fetch DNS pinning, child-env allowlist, plus plans 007–009.

## Selection default (recorded per skill rule)

The operator interrupted the plan-selection question with "continue", so the
**top 5 findings by leverage** were written as plans A–E from the audit
report. The other vetted findings were considered and are recorded below.

## Baseline facts every executor must know

Measured at `faf1afd22` with `--force` (no turbo cache), 2026-10-09:

- `bun run typecheck` ✅ (15/15), `bun run lint` ✅ (0 errors, 17 warnings),
  `bun run verify:doc-paths` ✅.
- `bun run verify:doc-frontmatter` ❌ — `.docs/research/audit-4-2026-10-07.md`
  lacks frontmatter (untracked in CI → CI stays green). Fixed by plan 001.
- Unit: 5846 pass / 1 skip / **1 fail** — `design color resolution > downgrades
accent for truecolor terminals`, caused by the uncommitted WIP
  `packages/design/src/tokens.ts` re-theme. Docs: 287 pass / **1 fail** —
  `docs design token drift`, same cause. Integration: 296 pass / 25 skip
  (compiled-binary smokes need a built binary) / 0 fail. **The WIP re-theme
  failures are not yours to fix.**
- `bun audit`: 13 advisories (2 critical, 5 high) — none reach the shipped
  CLI (all in docs-site / relay-server / vite paths).

## Findings considered and NOT planned (with rationale)

- **Phase-0 register (audit-4 §8, 15 items, 14 still live on HEAD)** —
  owned by `.docs/research/audit-4-2026-10-07.md` + open PRs #502/#592/#601/#602;
  re-filing as plans would fork the register.
- **CI security residuals**: `pull_request_target` review + actionlint CI gate
  — owned by `.plans/2026-10-01-r07-build-and-analytics.md`. Plan 002 delivers
  its two concrete interpolation instances.
- **Dependency advisories (13)** — owned by `.plans/063-dependency-upgrade-retrospective.md`
  disposition table (tinypool/braces/sprintf-js = accepted risk; remaining are
  docs-site/relay-only, none shipped in the CLI binary).
- **Relay roster Windows-order fix (FIX-02)** — LOW confidence of real
  impact; verify on Windows first before planning.
- **Provider-resolve hardening** (health recovery, latency ordering,
  hedge-delay calibration) — owned by
  `.plans/provider-resolve-hardening-handoff.md`; plan 003 deliberately does
  not fold it in.
- **`test/support` fixture divergence (TQ-07), pty-transcript skip (TQ-08),
  package timeout budgets (TQ-09), process-shutdown gate (TQ-01), bare-sleep
  ratchet across remaining 18 files (TQ-05 residue)** — audit-4 test-quality
  register items beyond this batch's leverage cutoff; the ratchet in plan 005
  freezes the residue.
- **Release-readiness action-tag pinning count** — owned by
  `.plans/2026-10-08-release-readiness.md`.
- **Reviewer nits** (bearer-style constant naming, chained casts) — not worth
  a plan; left to normal review.

## Findings reported but only partially plannable

- **Dirty-tree/PR overlap process risk** — open PRs #502/#592/#601/#602
  overlap post-audit fix commits; plan 001 addresses the working tree, but
  cross-PR reconciliation is a maintainer process decision, not an agent plan.
- **`packages/storage/undefined/` producer class** (unexported env var +
  string-concat paths) — plan 001 removes the artifact, adds a repo guard, and
  documents the producing pattern; the ideal fix (Bun `join`/sandbox-write
  gate in CI) is direction work recorded in the audit report, not planned
  here.

## Conventions for executors

- Branch per plan: `advisor/NNN-<slug>` (house convention — see `.plans/roadmap.md`
  rows 048–058).
- Never `bun test` directly — use `bun run test` / `bun run --cwd <pkg> test:file`.
- Do not touch the maintainer's uncommitted WIP (`packages/design/src/tokens.ts`,
  `.plans/*` content, untracked `.plans/2026-*.md` files).
- Update your plan's status row in this table when done.
