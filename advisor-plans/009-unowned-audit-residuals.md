# Plan 009: Sweep the verified-unowned audit residuals

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.

> **Drift check (run first)**: `git diff --stat 2f2537e2f..HEAD -- apps/cli/src/services/diagnostics/redaction.ts packages/storage/src/ttl.ts packages/providers/src/videasy/manifest.ts packages/storage/src/repositories/history-title-aliases.ts packages/storage/src/repositories/followed-titles.ts`
> If any file moved, re-read the live version before proceeding.

## Status

- **Priority**: P2 — item 5 alone justifies it (a palette `x` keystroke can
  abort a running download under the overlay); items 1–4 are P3 hygiene riding
  the same branch
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: defense-in-depth / hygiene
- **Planned at**: `origin/main` = `2f2537e2f`, 2026-10-19

## Why this is a single plan

The 2026-10-19 re-audit verified the pasted third-party findings against
`origin/main` line by line. Nearly every live item was already owned by
`.plans/2026-10-08-release-readiness.md`, `.docs/research/audit-4-2026-10-07.md`,
plans 007–008, or an open PR. These five are the residue: each verified live on
main, each unowned (item 5 is an unlisted sibling of an owned row), each too
small for its own plan. They share no code, but they share a fix shape — one
failing test + one narrow patch each.

## Items

### Item 1 — Diagnostics redaction denylist misses common key shapes

**File**: `apps/cli/src/services/diagnostics/redaction.ts:26-42` (on main).

`SENSITIVE_KEYS` covers `authorization`, `cookie`, `token` variants and
`videasysessiontoken`, but not `password`, `passwd`, `secret`,
`client-secret`, `private-key`, or `apikey` (only `api-key` is present — the
separator matters; an `apikey` field passes through unredacted). Any future
diagnostic context or provider trace that carries a field under one of those
names ships plaintext into `logs.txt` / support bundles.

**Fix**: add the missing names to `SENSITIVE_KEYS`. While there, normalize the
lookup the same way `SENSITIVE_QUERY_KEYS` treats its entries — check whether
the redactor already lowercases+unseparates keys (`key.toLowerCase()` at :74
handles case only); if separators aren't collapsed, add a strip of `-`/`_`
before the set lookup so `api_key`/`apikey`/`api-key` are one entry.

**Test that must fail first**: a unit test that runs the redactor over
`{ password: "hunter2", clientSecret: "x", apikey: "y" }` and asserts all three
values are replaced. Put it beside the existing redaction tests
(`apps/cli/test/unit/**/redaction*.test.ts` — find it with
`git grep -l redaction apps/cli/test`).

### Item 2 — `isExpired` fails open on a corrupt `expires_at`, and the sweep can't see the row either

**File**: `packages/storage/src/ttl.ts:36-38` (on main):

```ts
export function isExpired(expiresAt: string, now = new Date()): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}
```

`Date.parse("garbage")` is `NaN`; `NaN <= t` is false → a corrupt `expires_at`
is **never expired** on the read path. Consumers: `stream-cache`,
`provider-cache`, `source-inventory`, `schedule-cache`,
`recommendation-cache`, `catalog-crosswalk`, `provider-title-bridge` (7+
repositories import `isExpired`). The write-side escape is just as real:
`maintenance.ts` prunes with `WHERE expires_at <= ?` — SQLite compares the
stored TEXT lexically, so a non-ISO string like `"garbage"` sorts above every
ISO date and the sweep row never matches either. One corrupt row becomes
immortal in both directions.

**Fix**: `isExpired` should treat unparseable input as expired —
`const t = Date.parse(expiresAt); return !Number.isFinite(t) || t <= now.getTime();`
(matching the house fail-open-for-cache convention: a bad cache row is a miss).
For the sweep side, the minimal honest fix is a doc note in `maintenance.ts`
that corrupt `expires_at` values are caught by `isExpired` fail-open at read
time — do **not** add a second sweep mechanism for a corruption case no writer
produces today.

**Test that must fail first**: a `ttl.test.ts` case asserting
`isExpired("not-a-date")` is `true`, plus one repository-level test (e.g.
`stream-cache`) that a row written with a corrupt `expires_at` reads as a miss
instead of a hit.

### Item 3 — Four per-entity data-DB tables have no delete path (retention decision needed)

**Verified on main by independent agent sweep**: `pruneDataTables` covers only
notifications + suppressions; `playback_events`/`playback_queue_sessions` are
owned by SI-01/SI-10. The following also have **zero** `DELETE FROM` anywhere
and were not named in any register row:

| Table                      | Repository                                 | Volume shape                                                      |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `history_title_aliases`    | `repositories/history-title-aliases.ts`    | one row per identity alias                                        |
| `followed_titles`          | `repositories/followed-titles.ts`          | one row per title; even "unfollow" keeps a `muted`/`implicit` row |
| `offline_title_policies`   | `repositories/offline-title-policies.ts`   | `enrolled=0` rows persist forever                                 |
| `offline_maintenance_jobs` | `repositories/offline-maintenance-jobs.ts` | cascades only via parent asset; no own delete                     |

These grow per-entity, not per-event — none is a fire-hose like
`playback_events` (~240 rows/hr). This item is a **decision**, not a defect:
either record "intentional durable state" in the owning doc, or add them to
the SI-01 data-DB maintenance sweep when that row lands. Do not bolt a bespoke
prune onto each — the release-readiness fix for SI-01 ("age plus row-cap sweep
in data-DB maintenance") is the natural host.

**Deliverable**: a short section in `.docs/architecture.md` (or the owning
doc) naming these four tables as intentionally-unbounded, OR a note appended
to the SI-01 row extending its scope. One test if a prune is added; none if
the decision is "by design".

### Item 4 — `VIDEOSY_PROVIDER_ID` is a live API typo

**File**: `packages/providers/src/videasy/manifest.ts:3`:
`export const VIDEOSY_PROVIDER_ID = "videasy"`. The constant name transposes
V-I-D-E-A-S-Y into V-I-D-E-O-S-Y. `VIDKING_PROVIDER_ID` already exists as a
deprecated alias, so the file supports the aliasing pattern.

**Fix**: introduce `VIDEASY_PROVIDER_ID = "videasy"` as the canonical name,
re-export `VIDEOSY_PROVIDER_ID = VIDEASY_PROVIDER_ID` marked `@deprecated`,
and rename internal uses (same file: :9, :37 and any importers —
`git grep VIDEOSY_PROVIDER_ID`). The string value never changes, so nothing
behavioral moves.

**Test that must fail first**: none — a pure rename covered by the existing
typecheck; assert via `git grep -n VIDEOSY_PROVIDER_ID` that only the
deprecated alias remains.

### Item 5 — Command palette keystrokes bleed into the downloads and library overlays

**Verified on main** (`2f2537e2f`). `root-overlay-shell.tsx:2233-2277` renders
`DownloadManagerContent`/`LibraryShell` **and** `<CommandPalette>` at the same
time when `commandMode` is on. Ink dispatches each keystroke to every mounted
`useInput` — the codebase itself knows this (the `root-overlay-shell.tsx:~994`
comment about one keystroke arming the settings filter), and `useShellInput`
is disabled only for the _settings_ overlay. Neither
`download-manager-shell.tsx`'s `useInput` (`{ isActive: true }` at ~:451) nor
`library-shell.tsx`'s (`{ isActive: titlesActive }` at ~:373) consults
`commandMode`, so while the palette is open:

- `x`/`X` in a palette query aborts/removes the selected download job
  (`download-manager-shell.tsx:380-384`); `r` retries it.
- Esc closes the palette _and_ the overlay beneath it
  (`download-manager-shell.tsx:332-335`, `library-shell.tsx:269-275`).
- Palette letters append into the library filter
  (`library-shell.tsx:293-308`).

The release-readiness "`/` capture" row (`.plans/2026-10-08-release-readiness.md:152`
on main) documents this mechanism for the **history** overlay only — downloads
and library are the unlisted siblings, and theirs is worse: it routes
destructive keys, not just a filter.

**Fix**: gate the underlying `useInput`s on `!commandMode` (thread the flag or
an `isActive` from the overlay dispatcher — the settings overlay already
disables `useShellInput` this way at `root-overlay-shell.tsx:~998`). One
structural fix: when `commandMode` is true, the non-palette surface's input
handler must be inert.

**Test that must fail first**: render the downloads overlay with `commandMode`
on (the Ink test harness already drives `useInput` surfaces); send `x` and
assert no abort is dispatched and no `confirmingDeletion` state changes; send
Esc and assert exactly one layer closes.

**Note**: the register row stays the owner of the mechanism; this item only
extends its surface list. If the maintainer prefers, fold it into that row
instead of executing it here — the evidence above is the missing half.

## Commands

| Purpose         | Command                                                      | Expected |
| --------------- | ------------------------------------------------------------ | -------- |
| Redaction tests | `bun run --cwd apps/cli test:file <the redaction test file>` | pass     |
| Storage tests   | `bun run --cwd packages/storage test`                        | pass     |
| Gates           | `bun run lint && bun run typecheck --force`                  | exit 0   |

## Scope

**In scope**: the four files named above (+ their test files and the
importers of `VIDEOSY_PROVIDER_ID`).

**Out of scope**: everything already owned — the release-readiness register
rows (SI-01..SI-10, DATA-_, ASYNC-_, Fence, Sanitizer sinks, Relay
finality…), the open PRs' scopes (#652/#655/#658/#633/#634/#637/#635/#639
etc.), plans 001–008, and any provider resolve logic. This plan deliberately
contains only items the 2026-10-19 re-audit could **not** map to an owner.

## Git workflow

Branch: `advisor/009-audit-residuals` off `origin/main`. Commit style:
conventional, e.g. `fix(hygiene): close unowned audit residuals`.

## Done criteria

- [ ] redaction covers `password`/`passwd`/`secret`/`client-secret`/
      `private-key`/`apikey` shapes, with a failing-first test
- [ ] `isExpired("not-a-date") === true`, with failing-first tests at ttl and
      one repository level
- [ ] the four insert-only tables have a recorded retention decision (doc note
      or SI-01 scope extension)
- [ ] `VIDEASY_PROVIDER_ID` is the canonical name; `VIDEOSY_*` remains only as
      a deprecated alias
- [ ] palette-open keystrokes cannot reach the downloads/library `useInput`s
      (Esc closes exactly one layer; `x`/`r` in a query do nothing underneath)
- [ ] `lint` + `typecheck --force` exit 0
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `isExpired` callers exist that depend on fail-open corrupt rows being
  _valid_ — if a test asserts a corrupt `expires_at` hits, stop and report;
  the convention may be intentional.
- Item 3's tables turn out to have delete paths added upstream after
  `2f2537e2f` (re-check `git grep "DELETE FROM <table>" HEAD` on your branch
  point before editing).
- The redaction set is generated or mirrored elsewhere (e.g. a config schema
  copy) — keep them in sync or report the duplication.

## Refuted claims recorded here so nobody re-files them

Verified against `origin/main` during this audit — **not bugs**:

- **Resolve-gate `""`-host poisoning** — `streamHost()` can return `""`, but
  `resolve-gate.ts` guards both the refused-set insert and the membership
  check with `if (host)`; `""` can never enter `refusedHosts`. The pasted
  claim was refuted by trace, not assumption.
- **`packages/storage/undefined/` is not a product bug** — plan 001's own
  forensic record shows the producer was a throwaway `bun -e` with an
  unexported env var (`dir` was `undefined`, string-concat into the path);
  `getKunaiPaths`/`join()` cannot stringify `undefined`. Artifact removal is
  plan 001; no code defect exists.
- **mpv one-shot preflight killing materialized local streams** — a verifier
  flagged `mpv.ts` preflight firing `SIGTERM` on a local `stream.mpd`; on main
  the call is gated by `needsMpvNetworkPreflight(url, urlKind)`
  (`mpv.ts:333`, `mpv-playback-url.ts:33`), which returns false for
  locally-admitted URLs. Fixed upstream.
- **Watchdog `coreIdle` swallowing cache stalls** — `playback-watchdog.ts` on
  HEAD had it; main dropped `coreIdle` from the inactivity predicate (mpm 0.41
  semantics: `core-idle=true, pause=false` during network stalls). Fixed.
- **Reconnect state never reset on replacement `play()`** — pasted claim said
  the replacement branch skipped resets; `resetCycleState()` runs
  unconditionally at `play()` entry before the `advanceCycleGeneration`
  branch on both trees.
- **KickAssAnime ships an unprobed manifest** — `fetchMasterPlaylist`
  succeeding IS the probe for the shipped URL (same exemption class as
  hianime, recorded in the gate-coverage test). The conditional
  `verifyCandidateStream` is a deliberate definitive-refusal check for the
  fetch-failed path.
- **Relay `hostMatches` suffix attack** — `endsWith(".example.com")` keeps the
  dot boundary; `evilexample.com` cannot match. Subdomain matching is
  intended.
