# Plan 008: Make the published provider-status board stop misreporting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.

> **Drift check (run first)**: `git diff --stat faf1afd22..HEAD -- packages/providers/scripts/provider-status-sweep.ts .github/workflows/provider-status-sweep.yml apps/cli/test/unit/scripts/provider-status-publication.test.ts`
> If the sweep script or workflow moved, re-read the live versions before
> proceeding.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / docs-truth (the docs site publishes these numbers)
- **Planned at**: commit `faf1afd22`, 2026-10-19

## Why this matters

`apps/docs/lib/generated-provider-status.json` is published by a daily GitHub
Actions sweep (`.github/workflows/provider-status-sweep.yml` →
`packages/providers/scripts/provider-status-sweep.ts`) and rendered on the docs
site. Three rows on the board are currently **wrong about why**, verified by
running the same sweep from a residential network on 2026-10-19:

| Provider  | Board says (GH runner)               | Residential run says    | Real cause                                                                                                                                                                                           |
| --------- | ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `youtube` | degraded — "resolve exhausted", 1 ms | healthy — 1 stream      | The sweep runner has no `yt-dlp`; `resolveYoutube` returns `yt-dlp-missing` instantly (`packages/providers/src/youtube/direct.ts:389`). The row measures the **runner's PATH**, not provider health. |
| `anidb`   | degraded — "resolve exhausted"       | degraded — same         | The pinned fixture `one-piece-69` resolves the show but returns `code: "not-found"` ("No AniDB streams for one-piece-69 episode 1 (sub)"). The fixture itself drifted; the provider may be fine.     |
| `vidrock` | degraded — exhausted in 36 ms        | **healthy — 4 streams** | GH datacenter egress gets a filtered/empty API answer (or probe refusal); nothing in the failure surfaces as WAF, so it classifies as `degraded` instead of `blocked`.                               |

The published board therefore under-reports health for datacenter-filtered
providers and over-reports a defect for youtube. A status page that cries wolf
teaches users to ignore it — and the same rows are the team's own tripwire for
detecting real upstream rotations (allanime's genuine crypto rotation is the
current example).

## Current state

- `packages/providers/scripts/provider-status-sweep.ts`:
  - `resolveContext` injects plain `fetch` + a 30 s `AbortSignal`, no cache, no
    endpoint health — by design.
  - `classify(upstreamHttp, resolveStatus, streams, firstFailureCode)` returns
    `dead | healthy | blocked | down | degraded` (verbatim below).
  - `blocked` only when `failures[0]?.code === "blocked"` **or** the failure
    message matches `/captcha|waf|challenge/i`. Any other exhausted shape —
    including "upstream filtered the runner's IP" and "fixture has no streams"
    — collapses into `degraded`.
  - The generic note `"upstream up but resolve exhausted"` **wins over**
    `failures[0].message`, so a `not-found` fixture answer is invisible in the
    published row.
  - `PROBES` fixtures: `MOVIE_INPUT` = tmdb:550 Fight Club; anime lane =
    `anilist:21` One Piece; allanime = `allanime:ReooPAxPMsHM4KPMY`;
    anidb = `one-piece-69`; youtube = `youtube:dQw4w9WgXcQ`.
- `.github/workflows/provider-status-sweep.yml`: installs Bun + the
  `setup-curl-impersonate` action. **No yt-dlp** — confirmed by inspection;
  youtube has reported `degraded` since ~2026-10-11 while resolving fine
  locally.
- `apps/cli/test/unit/scripts/provider-status-publication.test.ts` — existing
  test file for the publication path; the natural home for classifier tests.
- `docs/users/provider-status.mdx` — the public page rendering the JSON.

```ts
// classify() as of faf1afd22 / origin/main:
if (upstreamHttp === null && resolveStatus !== "resolved")
  return { status: "dead", note: "upstream unreachable" };
if (resolveStatus === "resolved" && streams > 0) return { status: "healthy", note: "" };
if (firstFailureCode === "blocked")
  return {
    status: "blocked",
    note: "upstream challenges this network (WAF/captcha); relay in an ungated region bypasses",
  };
if (upstreamHttp === 503) return { status: "down", note: "upstream reports maintenance" };
if (resolveStatus === "exhausted")
  return { status: "degraded", note: "upstream up but resolve exhausted" };
return { status: "degraded", note: `resolve status ${resolveStatus}` };
```

## Commands you will need

| Purpose                | Command                                                                                  | Expected on success                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Sweep tests            | `bun run --cwd apps/cli test:file test/unit/scripts/provider-status-publication.test.ts` | all pass                                                                                          |
| Provider pkg tests     | `bun run --cwd packages/providers test`                                                  | all pass                                                                                          |
| Local sweep (optional) | `bun run --cwd packages/providers scripts/provider-status-sweep.ts`                      | writes JSON; **restore the file afterward with `git checkout`** — the committed copy is bot-owned |
| Lint/typecheck         | `bun run lint && bun run typecheck --force`                                              | exit 0                                                                                            |

## Scope

**In scope**:

- `packages/providers/scripts/provider-status-sweep.ts`
- `.github/workflows/provider-status-sweep.yml`
- `apps/cli/test/unit/scripts/provider-status-publication.test.ts` (or a new
  adjacent test file for `classify`, if the existing file's shape makes that
  cleaner — export `classify` from the sweep script; it is already exported)
- `docs/users/provider-status.mdx` **only if** a new status label is added and
  the page's legend must name it

**Out of scope**:

- `generated-provider-status.json` — bot-written; the next daily sweep
  regenerates it.
- Any provider module's resolve logic — this plan fixes the _measurement_, not
  the providers. AllManga's real outage is plan 007.
- `.github/scripts/publish-provider-status.sh` — the commit/publish half is fine.

## Git workflow

- Branch: `advisor/008-status-sweep-truth` off `origin/main`.
- Commit style: conventional, e.g. `fix(status): classify sweep rows by failure evidence`.

## Steps

### Step 1: Give youtube a real probe or an honest row

Pick **one** (recommend a — it makes the row real rather than a disclaimer):

a. Install yt-dlp in the sweep job. `.github/workflows/provider-status-sweep.yml`,
after `setup-curl-impersonate`:

```yaml
- name: Install yt-dlp
  run: pipx install yt-dlp || pip install yt-dlp
```

(`pipx` is preinstalled on `ubuntu-latest`; fall back to `pip` if it isn't.)

b. OR classify `code === "yt-dlp-missing"` (and any future
`*-missing-runtime` code) as a distinct row: `status: "unprobed"`,
`note: "probe environment lacks yt-dlp — not a provider verdict"`. If you
add this status value, `docs/users/provider-status.mdx`'s legend and the
JSON schema check in `publish-provider-status.sh` may need the new enum —
check both.

**Verify**: `bun run --cwd apps/cli test:file test/unit/scripts/provider-status-publication.test.ts` → pass.

### Step 2: Separate "fixture drifted" from "provider degraded"

In `classify`, when `resolveStatus === "exhausted"` and
`firstFailureCode === "not-found"`, the pinned title itself is suspect (the
sweep resolves exactly one known-good fixture per provider — a `not-found`
says more about the fixture than the provider). Classify as `degraded` with an
explicit note, e.g. `note: "pinned fixture returned not-found — re-pin the probe title"`,
instead of the generic exhausted note.

Then **re-pin the anidb fixture**: find a current provider-native id for a
long-running show on anidb.app (the One Piece id `one-piece-69` no longer
carries episode-1 streams). Search the provider's own listing — the smoke
`apps/cli/test/live/anidb-onigiri.smoke.ts` shows the search flow; a live
`resolve` attempt with a fresh id is the check.

**Verify**: unit test asserting `classify(200, "exhausted", 0, "not-found")`
yields the fixture note; and a local sweep run reports anidb's new fixture
resolved or with its real failure.

### Step 3: Surface the failure evidence, not just the verdict

`note` currently prefers the generic classified string. Make exhausted rows
carry `failures[0].message` (truncated, as the code already does for the
no-note case) when it exists — so "No AniDB streams for one-piece-69…" or a
filtered-empty upstream answer is visible on the board instead of
"upstream up but resolve exhausted" for everything.

**Verify**: unit test — exhausted with a `not-found` failure message lands the
message (or the step-2 fixture note) in `note`, not the generic string.

### Step 4: Reconcile the "blocked" class with egress reality

WAF-marked providers classify `blocked` correctly, but a datacenter-filtered
empty response (vidrock today) lands in `degraded`. Options — pick the smallest
that is honest:

- If the provider's failure carries a recognizable code/message for the
  filtered case (e.g. an empty-but-200 API map, or `candidate-blocked`), map it
  to `blocked` with a note naming the egress caveat.
- If it doesn't, at minimum append `"(or the runner's egress is filtered)"` to
  the exhausted note so readers don't read `degraded` as upstream-broken.

Do **not** invent a per-provider override table — the fix is a classification
rule, not a hand-maintained truth list.

**Verify**: unit test pinning whichever mapping you implement.

### Step 5: Gates

```sh
bun run --cwd apps/cli test:file test/unit/scripts/provider-status-publication.test.ts
bun run --cwd packages/providers test
bun run lint && bun run typecheck --force
```

Optionally run the sweep locally for the before/after screenshot — restore the
JSON afterward (`git checkout apps/docs/lib/generated-provider-status.json`).

## Test plan

- Extend `apps/cli/test/unit/scripts/provider-status-publication.test.ts` (or a
  new `provider-status-classify.test.ts` beside it) with one test per new
  classification rule:
  - `yt-dlp-missing`/`runtime-missing` → unprobed (if step 1b chosen)
  - exhausted + `not-found` → fixture-drift note
  - exhausted + failure message → message survives into `note`
  - the step-4 mapping
- Import `classify` from the sweep script (it is already `export`ed).

## Done criteria

- [ ] youtube's row is either truly probed (yt-dlp in workflow) or labeled as
      unprobed — never silently "degraded" for a missing binary
- [ ] `not-found` on a pinned fixture produces a fixture-drift note
- [ ] exhausted rows carry the first failure's message when present
- [ ] the vidrock-class filtered-egress case no longer reads as plain
      upstream-degraded
- [ ] anidb's fixture id is re-pinned (or the row honestly reports fixture drift)
- [ ] new unit tests pass; `lint` and `typecheck --force` exit 0
- [ ] `generated-provider-status.json` is NOT committed by this change
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The sweep script's exports or `ProbeSpec`/`ProviderRow` types changed —
  re-read it; the classify signature this plan assumes may have moved.
- `docs/users/provider-status.mdx` renders statuses from a hardcoded legend and
  adding `unprobed` requires touching generated docs tooling — report instead
  of growing scope; fall back to step 1a only.
- The anidb replacement fixture cannot be found that has episode streams
  (e.g. anidb.app itself delisted the catalog) — then the provider is
  genuinely degraded and the fixture-drift classification alone is the fix;
  say so.

## Maintenance notes

- The sweep is the project's early-warning for exactly the allanime-class
  rotation happening right now; keeping its rows truthful is what makes the
  next rotation visible in a day instead of a week.
- If the fixture-drift note ships, expect it to fire periodically as upstreams
  re-id titles — that is the feature working, not noise.
- A future improvement deliberately left out: probing a second, dynamically
  chosen title when the pinned fixture returns `not-found`, which would
  self-heal fixture drift at the cost of a search-path dependency.
