# Resolve UX and Playwright Lifecycle

Status: Planned — pick up when doing a Playwright/provider reliability pass

These items came out of the May 2026 session that shipped clean Esc cancel, Ctrl+C
fixes, and immediate cancel feedback. They are deferred because they need either
provider-level Playwright access or a config schema extension.

---

## 1. Provider-level abort: kill the browser on Esc

**Problem.** When the user presses Esc during stream resolution, we call
`resolveController.abort()`. The `AbortSignal` is forwarded to `resolveWithFallback`
and on to each `p.resolveStream(..., signal)`, but individual providers do not act on it
mid-scrape. The Playwright browser page continues running until it finishes or times out.
The user sees "Cancelling…" and eventually gets back to results — but a background
Chromium scrape is still alive consuming memory and CPU.

**Fix.** Each provider that uses Playwright needs to listen for the abort signal and
close its page (or context) immediately when it fires. The typical pattern:

```ts
signal.addEventListener(
  "abort",
  () => {
    void page.close().catch(() => {});
  },
  { once: true },
);
```

Where to do this: inside each provider's `resolveStream` method (or the shared
scraper helper it delegates to), right after `page` is acquired from the browser pool.

**Scope.** Touches every Playwright-backed provider. Should be done as part of a
Playwright reliability pass — see also the runtime-browser package plan in
[roadmap.md](roadmap.md).

**Contract.** After this lands, Esc during resolve should terminate the Chromium page
within ~200 ms. The existing `resolveController.signal.aborted` check in
`PlaybackPhase` already handles the clean return — this just closes the browser faster.

---

## 2. Episode memory: remember the last attempted episode after cancel

**Problem.** If the user cancels during resolve (or after a resolve failure) and goes
back to search results, then re-selects the same title, they land at the
`chooseStartingEpisode` picker from scratch. They have to navigate back to the episode
they were trying to watch.

**Fix.** When `PlaybackPhase` returns `back_to_results` after a user-initiated cancel,
pass a `lastAttemptedEpisode` hint back to `SessionController`. The controller then
carries it into the next `PlaybackPhase` invocation for the same title so the picker
pre-selects it.

Implementation sketch:

- Extend `PlaybackOutcome` with an optional `lastAttemptedEpisode?: EpisodeInfo` field
  on the `"back_to_results"` path
- In `PlaybackPhase`, populate it from `currentEpisode` before returning
- In `SessionController`, detect same-title re-entry and forward the hint
- In the episode picker / `chooseStartingEpisode`, accept and pre-select the hint

**Scope.** Small — a few typed fields and one conditional branch in SessionController.
Can be done independently of Playwright work.

---

## 3. Per-provider resolve timeout configuration

**Problem.** Some providers are reliably slow (30+ s). There is no way to configure a
shorter timeout so the user bails faster on known-slow sources or when they want
snappier fallback cycling.

**Fix.** Add `resolveTimeoutMs?: number` to the provider override config
(`~/.config/kunai/providers.json`) and thread it through `resolveWithFallback` as a
per-candidate deadline. If the candidate's resolve promise doesn't settle within the
timeout, treat it as a failure and move to the next candidate.

Implementation sketch:

- Extend `ProviderConfig` / provider override schema with `resolveTimeoutMs`
- In `PlaybackPhase`, read it from the provider registry and wrap `p.resolveStream`
  with `Promise.race([resolve(), Bun.sleep(timeout).then(() => null)])` when set
- Default: no timeout (current behavior)

**Scope.** Config schema + one Promise.race wrapper. Can be done in isolation.

---

## 4. Provider health indicator

**Problem.** There is no visible signal for how recently a provider succeeded or failed.
The user has no way to know upfront whether their current provider is likely to work
before committing to a full resolve attempt.

**Fix.** Track per-provider resolve outcomes (last success timestamp, last failure
message, consecutive failure count) in a lightweight in-memory store during the session.
Surface this as a badge in the browse shell's provider badge or the provider picker.

Example display: `provider vidking · last ok 2m ago` or `provider cineby · 2 failures`.

Implementation sketch:

- Add a `ProviderHealthTracker` service to the container (in-memory, no persistence
  needed initially)
- `PlaybackPhase` records success/failure outcomes on each resolve attempt
- The browse shell reads the tracker when building the provider badge label
- Optionally persist across sessions to `kunai-data.sqlite` later

**Scope.** New lightweight service + wiring into PlaybackPhase and the browse badge.
Independent of Playwright work.

---

## Suggested sequencing

| Priority | Item                           | Effort | Depends on                  |
| -------- | ------------------------------ | ------ | --------------------------- |
| 1        | Episode memory (#2)            | Small  | Nothing                     |
| 2        | Per-provider timeout (#3)      | Small  | Nothing                     |
| 3        | Provider health indicator (#4) | Medium | Nothing                     |
| 4        | Provider-level abort (#1)      | Medium | Playwright reliability pass |

Items 2 and 3 can be done in any order as quick standalone improvements.
Item 1 is the most directly felt UX gap. Item 4 is the most satisfying but
requires touching every Playwright-backed provider.
