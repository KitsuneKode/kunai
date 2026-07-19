# Handoff — Queue UX and remaining 0.3.0 work

Written 2026-07-20. Everything below was verified against the code on `main`
that day, not recalled. Where I state a fact, the file and line are given so the
next session can re-check rather than trust.

---

## 1. Correction to carry forward

Earlier in the previous session I said "there is no shell-level entry point for
starting playback; it only happens through the phase loop." **That was wrong,
and the mistake matters** — it would have led to inventing a mechanism that
already exists.

There _is_ a shell→phase-loop channel, and the queue already uses it:

```
/up-next
  → openRootQueueSelection()          apps/cli/src/app-shell/dispatch-palette-command.ts:163
  → openRootOwnedOverlay({type:"queue"})
  → waitForRootQueueSelection()       apps/cli/src/app-shell/root-queue-bridge.ts:22
  → (user picks a row)
  → resolveRootQueueSelection(...)    apps/cli/src/app-shell/root-overlay-shell.tsx:1372
  → returns { type: "history-entry", title, episode }
  → phase loop plays it
```

`root-history-bridge.ts` uses the identical promise-bridge pattern. **Playing
from Up Next already works today.**

### The real architectural finding

There are **two competing patterns** for handing an intent from the shell to the
phase loop, and only one of them works reliably:

| Pattern                                                            | Used by        | Works?     |
| ------------------------------------------------------------------ | -------------- | ---------- |
| Promise bridge (`waitForRoot*Selection` / `resolveRoot*Selection`) | queue, history | Yes        |
| Staged module global (`stageNotificationPlaybackIntent`)           | notifications  | Was broken |

The staged-global pattern is what caused the notification "play now" bug fixed in
`a564abcf`: the intent was staged but only ever read by the palette route, so
opening the inbox any other way stranded it (and it later fired against an
unrelated session, playing the wrong title).

**Recommended cleanup:** migrate notifications onto the promise-bridge pattern so
there is one way to do this, not two. That is the single-source-of-truth fix; the
commit above only bounded the damage.

---

## 2. Queue work — the backend is already done

`apps/cli/src/domain/queue/QueueService.ts` is **complete**. Do not rebuild it.
Verified methods:

| Need                   | Method                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| add                    | `enqueue`, `enqueueMediaItem`, `enqueueBatch`                                         |
| next in line           | `peekNext()`                                                                          |
| advance                | `advance()`, `markCurrentPlayed()`                                                    |
| reorder                | `moveUp`, `moveDown`, `moveUpInQueue`, `moveDownInQueue`, `moveToTop`, `moveToBottom` |
| remove                 | `remove(id)`, `clear()`, `clearPlayed()`                                              |
| read                   | `getAll()`, `getUnplayed()`, `getStatus()`                                            |
| resume across sessions | `listRecoverableSessions()`, `restoreRecoverableSession()`, `prepareForShutdown()`    |
| refill                 | `refillFromWatchlist(listService)`                                                    |

Persistence: `packages/storage/src/repositories/queue.ts`.

UI already present: `apps/cli/src/app-shell/queue-shell.tsx`,
`queue-view.ts`, `queue-poster-resolver.ts`, `root-queue-bridge.ts`.

**So the work is wiring and UX, not services.** Start by auditing which of the
methods above are reachable from the UI — my strong suspicion (unverified) is
that reorder, remove, and `peekNext` are implemented but not bound to keys or
surfaced anywhere.

### The product goal, in the user's words

> "YouTube-like feel but with Netflix-like good content."

Concretely that means:

1. **Auto-advance.** Finishing an episode plays the next queue entry without a
   prompt. `advance()` + `markCurrentPlayed()` exist; check whether post-play
   (`apps/cli/src/app/playback/run-post-playback-menu.ts`) consults the queue at
   all, or only offers the next episode of the same series.
2. **Always show what's next.** A persistent "Next: <title>" hint from
   `peekNext()` — on the post-play screen and in the playback footer. This is the
   single highest-value cue for a queue to feel alive.
3. **Reorder in place.** Bind `moveUp`/`moveDown`/`moveToTop` to keys in the
   queue overlay. Follow the existing footer-action pattern; do **not** invent
   new chords without checking `keybindings.ts`.
4. **Add/remove from anywhere.** A consistent "add to queue" action on browse
   rows, details sheet, and notifications.
5. **Resume the queue.** `restoreRecoverableSession()` exists and is already
   wired into the notification router's `restore-queue` action — verify it end to
   end; that path shares the bug class fixed in `a564abcf`.

### Hard-won constraints (do not relearn these)

- **Never bind `Ctrl+M` or `Ctrl+Shift+M`.** Both are byte-identical to Enter in
  legacy terminal encoding. Any such binding is silently dead.
- **Keep list rebuilds off the keyboard hot path.** Memoize on a revision, as the
  notification and diagnostics overlays do. A calendar regression on 2026-06-16
  came from exactly this; poster rendering from a nav hot path caused another.
- **Overlay opens come from two places.** `dispatch-palette-command.ts` (palette)
  and a direct `OPEN_OVERLAY` dispatch in `root-overlay-shell.tsx` (~line 810).
  Any new intent must work on _both_ or it will be stranded — that is precisely
  the notification bug.

---

## 3. Other open work, in priority order

### #26 — Release blocker (only the user can finish this)

The composite-checkout fix is committed and **appears to work**: the
`Build all release binaries` run on main succeeded in 1m3s (it used to fail
instantly). The `Release` workflow still failed, but only on the shutdown test
below. Needs one real `workflow_dispatch` run of `release.yml` reaching publish.

### #33 — `process-shutdown.test.ts` fails on CI, passes locally

`kill() failed: ESRCH`. Root cause **still unknown**.

- The "stdin EOF tears down the pty" hypothesis was **tested and disproven** —
  the CLI stays alive locally under both `stdin: "ignore"` and `"pipe"`.
- The test now captures the pty transcript and fails with a real diagnostic plus
  a liveness check instead of an opaque `ESRCH`.
- **Next step: read the next CI failure output.** It will name the cause.

### #30 — E2E playback harness

30s of real playback (movie / series / anime) against the **compiled binary**,
plus mpv IPC assertions. Highest long-term safety value: this class of test is
what caught the bundle-budget break on 2026-07-20 that every unit test missed.

### #29 — Packaging boundaries

`apps/cli/src` is 679 files (app-shell 220, services 201) against
`packages/core` 17, `types` 2, `schemas` 1. `packages/ui-cli` was a ghost and is
now deleted. Decide what genuinely belongs in packages. See the existing
`project_domain_packaging` note: continuation/history authority is app-resident.

### #32 — README

Currently dev-oriented. Should read as a product page: what Kunai is, what it
does for the user, real usage, casts/screenshots.

### #18 — Manual terminal QA

Deliberately deferred to last. Run in kitty **and** one plain terminal.

---

## 4. Things that will bite you if unknown

- **`.release/kunai-v0.2.6.json` absorbs local build checksums** whenever
  `build-binaries.ts` runs. I reverted it twice. Those hashes must come from CI —
  if a release ships with locally-generated sums, user verification breaks.
  Consider gitignoring it or generating it only in CI.
- **Turbo caches test results.** Always `--force` before trusting a green run. A
  cached pass previously masked a real boundary violation.
- **`bun build --compile` can leave a mode-`----------` `.bun-build` temp file**
  in `apps/cli/` if interrupted. Turbo then dies with `Permission denied (os
error 13)` and no useful message. `rm -f apps/cli/.*.bun-build`.
- **npm bundle budget is 2688 KiB** (`apps/cli/scripts/build-shared.ts`), raised
  from 2560 for the JPEG decoder. Reason is recorded at the constant. Only move
  it for a decision of that weight.
- **Gates:** `bun run typecheck`, `bun run lint` (0 warnings **and** 0 errors),
  `bunx turbo run test --force`, `bun run build`. Current baseline: 14/14, 0/0,
  2781 pass / 0 fail.

---

## 5. Suggested opening prompt for the new session

> Read `.plans/handoff-queues-and-remaining-work.md` first.
>
> I want to make the queue feel like YouTube's Up Next but for real shows —
> always know what's next, auto-advance, reorder and remove in place, add from
> anywhere, and resume a queue across sessions.
>
> `QueueService` is already complete, so this is UI/UX wiring, not new services.
> Start by auditing which QueueService methods are actually reachable from the UI
> today and show me that gap list before writing code. Then propose the design
> for auto-advance and the "Next: …" hint, including where queue-initiated
> playback enters the phase loop — note that the promise-bridge pattern in
> `root-queue-bridge.ts` already solves this and should be reused, not replaced.
