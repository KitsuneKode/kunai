# 020 — Fix the silent no-ops users hit daily

- **Written against commit**: `01ab215b`
- **Priority**: P1
- **Effort**: M (seven independent S fixes)
- **Risk**: LOW per fix, except 020.3 (dedup key) which needs a migration decision
- **Depends on**: nothing. Each sub-fix is independent — land them as separate
  commits so a bad one can be reverted alone.

## Why this matters

Every item below is a feature that reports success and does nothing. They are
unrelated in code and identical in character: **the write happens and the read
does not.** All are small, all are independently verifiable, all are felt daily.

Fix them in the listed order (cheapest and most-felt first). Do not batch them into
one commit.

---

## 020.1 — `--zen` / `-m` permanently rewrite the user's config file

**Evidence.** `apps/cli/src/main.ts` ~line 733 carries this promise:

> `--zen` / `-m,--minimal` are transient session overrides ... without persisting to
> the user's config file (update() mutates memory only; save() is never called here).

Both halves are true in isolation and the guarantee is still false:

- `config.update(sessionOverrides)` writes `zenMode` / `minimalMode` into
  `this.config`.
- `ConfigServiceImpl.persistPendingSave()` (~line 727) calls
  `this.store.save(this.config)` — the **entire** object.
- `UpdateService.ts` (lines ~57, 89, 110, 120) and `TelemetryService.ts` (lines ~80,
  93, 135, 148) make **eight unconditional `config.save()` calls**, and both run on
  startup (`main.ts` ~823-882).

So one `kunai --zen` run permanently flips zen mode as soon as the background update
check fires. The user gets a permanently zen shell with no memory of asking.

**Fix.** Keep session overrides out of `this.config`. Hold them in a separate
`sessionOverrides` field on `ConfigServiceImpl` that the getters merge over the
persisted object but `store.save()` never sees.

**Verify.**

```sh
cd apps/cli && bun test test/unit/services/persistence/ConfigServiceImpl.test.ts
```

New test: apply a session override, call `save()`, reload the store, assert the
persisted object does **not** contain it — while the getter still reports it.

---

## 020.2 — Dismissing a notification promotes it to the top of the inbox

**Evidence.** `packages/storage/src/repositories/notifications.ts` ~line 188:

```ts
dismissByDedupKey(dedupKey, dismissedAt) {
  // UPDATE notifications SET dismissed_at = ?, updated_at = ? WHERE dedup_key = ?
}
```

`dismissed_at` is never read by any predicate. Confirm:

```sh
rg -n 'dismissed_at' packages/storage/src/repositories/notifications.ts
```

Four hits only: a type field, a row mapper, an INSERT column list, and that UPDATE.
`listActive` / `listAllActive` / `countActive` / `countUnread` all filter on
`archived_at IS NULL` alone, and `listActive` orders by `updated_at DESC`.

Net effect: dismiss keeps the notice **active**, keeps it **unread**, and moves it
to the **top**. The exact inverse of intent. `migrations.ts:445` already calls the
column "the legacy `dismissed_at`".

The inbox path silently worked around this by calling `archive` instead
(`root-overlay-shell.tsx:1119`), so the two dismiss paths have diverged — every
non-inbox surface (browse, calendar, library, history, via
`create-container-media-action-router.ts:86-93`) gets the broken one.

**Fix (preferred).** Point `NotificationService.dismiss` at `archive`, matching what
the inbox already does, and retire `dismissByDedupKey`. One-line change with existing
archive coverage.

**Alternative** (only if dismiss must stay distinct from archive): add
`AND dismissed_at IS NULL` to all four active queries and stop bumping `updated_at`.

**Verify.** Add the missing repository test — `dismissByDedupKey` is the only
repository method with none (`packages/storage/test/notifications-repository.test.ts`
is 129 lines and covers every other one). Assert that after a dismiss the row is
absent from `listActive`/`listAllActive`, both counts decrease, and relative order of
other rows is unchanged.

---

## 020.3 — Followed-but-unwatched titles are silently dropped from reconciliation

**Evidence.** A clean four-step chain in
`apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts`:

1. `syntheticHistoryFromFollowed` (~line 44) builds the anchor with `episode: 0`.
2. `toReleaseReconciliationHistoryRows` (~line 186) computes
   `row.episode ?? row.absoluteEpisode ?? 1` — and **`0 ?? 1` is `0`**, because
   nullish coalescing only falls through on `null`/`undefined`.
3. `toEpisodeCursor` → `isNormalEpisodeCursor` (`apps/cli/src/domain/media/episode-cursor.ts:25`)
   rejects `episode <= 0`, returning `undefined`.
4. `if (!cursor) return []` drops the row.

So a title you **follow but have not started** is never checked for new episodes,
never gets a release projection, and can never notify. That is the entire point of
the follow feature.

The existing test asserts `rows[1].episode === 0` and stops one function short of
the bug.

**Fix.** Give the synthetic anchor a cursor the planner accepts (e.g. `episode: 1`
with an explicit "no progress" marker), or teach
`toReleaseReconciliationHistoryRows` to emit a no-progress anchor for `episode === 0`.
Budget caps in `RECONCILIATION_TRIGGER_BUDGETS` already bound the fan-out, so this
only adds candidates.

**Verify.** A test that runs `collectReleaseReconciliationRows` output **straight
through** `toReleaseReconciliationHistoryRows` and asserts a followed-unwatched title
survives. The current test's gap is exactly that it never composes the two.

---

## 020.4 — Calendar is off by a day/week outside UTC

Two independent UTC/local mixups in `apps/cli/src/app-shell/calendar-ui.model.ts`.
The maintainer is in **IST (+05:30)**, so both bite daily.

**Bug A** (~line 574): `currentWeekKey` derives from
`new Date(nowMs).toISOString().slice(0, 10)` — the **UTC** date — while every row's
`dayKey` uses `getFullYear()/getMonth()/getDate()` — **local**. Before 05:30 IST
these land in different weeks, so the current week fails the
`weekKey !== currentWeekKey` guard and gets tagged. Monday mornings there is no
"this week" band at all and today's rows read "next week".

**Bug B** (`calendarWeekKeyFromIsoDay`, ~line 162): walks back to Monday in _local_
time, then returns `.toISOString()` (_UTC_). East of UTC, local Monday 00:00 is the
previous UTC day, so every "Week of …" header shows the **Sunday** date.

**Fix.** The correct helper already exists in the same file: `calendarLocalDayKey`
(~line 102). Use it at both sites so week bucketing and day bucketing share one clock.

**Verify.** `apps/cli/test/unit/app-shell/calendar-ui.test.ts` never pins `TZ`, so it
structurally cannot catch either bug. Add a parameterised suite running under at
least `UTC`, `Asia/Kolkata` (+05:30) and `America/New_York`, asserting the week key
is always the **local** Monday and that a row whose local date is today is never
tagged.

---

## 020.5 — `--no-user-mpv-config` has never worked

**Evidence.** Proven by execution, not inspection:

```sh
cd apps/cli && bun -e '
import { Command } from "commander";
const c = new Command();
c.option("--no-user-mpv-config", "x");
c.parse(["node","kunai","--no-user-mpv-config"]);
console.log(JSON.stringify(c.opts()));'
# -> {"userMpvConfig":false}
```

Commander treats `--no-x` as the negation of `x`. `cli-args.ts:361` reads
`options.noUserMpvConfig`, which is permanently `undefined`, so `mpv.ts:578`'s
`--no-config` is reachable only via `--mpv-clean`.

The flag is advertised in the CLI help text, `.docs/cli-reference.md:93`,
`docs/users/cli-reference.mdx:86`, and the generated public docs table.

**Fix.** Read `options.userMpvConfig === false`. Then add a parity test asserting
every `.option()` in `createCliCommand()` appears in `buildCliHelpText()` and vice
versa — the docs generator parses the help string, so parser/help drift is currently
invisible.

---

## 020.6 — Favorites, streaks and the weekly digest never persist

Three sites call `config.update(...)` with no `save()`. `update()` only mutates
memory; `save()` is the debounced writer.

| Site                                              | Effect                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root-overlay-shell.tsx:1268` (`favoriteSources`) | Tracks panel advertises `f favorite` and sorts favorites-first; the choice is gone next launch. This is the **only** writer of `favoriteSources`. |
| `ink-shell.tsx:410` (`lastStreakMilestoneDays`)   | "🔥 7-day streak!" re-fires on every launch.                                                                                                      |
| `ink-shell.tsx:502` (`lastWeeklyDigestShownAt`)   | Weekly digest shows every launch instead of weekly.                                                                                               |

`apps/cli/src/app/search/SearchPhase.ts:679-680` does it correctly (`update` then
`save`) and is the pattern to copy.

**Fix.** Add the `save()` (fire-and-forget with a `.catch` inside interval effects).
Consider making `update()` schedule the debounced save itself so this cannot recur —
if you do, check every existing `update()` caller first and note it in the PR.

---

## 020.7 — About panel reports the wrong version

`apps/cli/src/app-shell/panel-data.ts` (`buildAboutPanelLines`, ~line 89) hardcodes
`"v0.1.0"`. The package is at **0.3.0**.

**Fix.** Read the real version the same way the rest of the CLI does (the release
notes script and `postinstall` both import `package.json`). Add an assertion that the
About version matches `package.json`.

---

## Done criteria

```sh
bun run typecheck && bun run lint && bun run test
```

Plus, per sub-fix, the specific test named in its section. Every one of the seven
must land with a test that **fails before the fix** — verify that by staging the
test first and watching it go red.

## Maintenance note

020.1, 020.6 and 020.2 are the same underlying shape: a write path whose read path
was never connected. After landing, consider extending
`apps/cli/test/unit/architecture/contract-conformance.test.ts` with a gate asserting
every `KitsuneConfig` key has a production reader outside `ConfigServiceImpl` — that
single gate would have caught 020.1, 020.6, `autoDownload`, `headless`,
`powerSaverAllowManualArtwork` and `updateChannel` at commit time.
