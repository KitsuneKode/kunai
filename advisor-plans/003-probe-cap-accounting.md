# Plan 003: Make the resolve-gate probe cap count actual probes, not candidate rows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat faf1afd22..HEAD -- packages/providers/src/shared/direct-stream-source.ts packages/providers/test/direct-stream-source.test.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `faf1afd22`, 2026-10-09

## Why this matters

Commit `574e31882` (audit-batch2) claims in its message:
_"probe cap counts probes, not candidate rows"_. That code does not exist —
the cap still slices the candidate array, so url-less rows consume probe
budget without ever probing. Two concrete consequences at HEAD:

1. If the first `RESOLVE_GATE_MAX_PROBES` rows lack a `url`, **zero probes
   run** and the resolve falls through as "resolved" with
   `streamReachabilityVerified === undefined` — the gate silently did nothing
   and ships `streams[0]` unverified.
2. If row 1 is probed-and-refused and rows 2–3 are url-less, the walk ends
   early with `gateFailure` set → the whole provider reports `exhausted`
   even though a live rung sits at index 4. A dead top rung still condemns
   live siblings — exactly what the commit message says was fixed.

Making the code match the claimed behavior is a small, bounded loop change
that keeps the probe budget at 3 actual probes.

## Current state

- `packages/providers/src/shared/direct-stream-source.ts` — the resolve-gate
  walk. `const RESOLVE_GATE_MAX_PROBES = 3;` at line 91 (this file's own
  constant — note `packages/providers/src/shared/resolve-gate.ts:16` has an
  unrelated `RESOLVE_GATE_MAX_PROBES = 2` used for timeout division; do not
  touch that file). The loop, lines 186–250 (abridged to the load-bearing
  parts; read the whole block before editing):

```ts
    let streamReachabilityVerified: boolean | undefined;
    const refusedStreamIds = new Set<string>();
    if (resolveGateProbe) {
      let gateFailure: ProviderFailure | undefined;
      let cancelled = false;

      for (const candidate of streams.slice(0, RESOLVE_GATE_MAX_PROBES)) {
        // A cancelled resolve must not keep spending probes, ...
        if (context.signal?.aborted) {
          cancelled = true;
          break;
        }
        if (!candidate.url) continue;

        const verdict = await verifyCandidateStream({
          stream: candidate,
          context,
          ...(options.resolveGateTimeoutMs === undefined
            ? null
            : { timeoutMs: options.resolveGateTimeoutMs }),
        });

        if (context.signal?.aborted) {
          cancelled = true;
          break;
        }

        if (verdict.accepted) {
          selectedStream = candidate;
          streamReachabilityVerified = verdict.verified;
          gateFailure = undefined;
          break;
        }

        const probe = verdict.probe;
        const reason = verdict.reason;
        // The gate refused this candidate definitively — drop it from the
        // shipped inventory below ...
        refusedStreamIds.add(candidate.id);
        // Keep the first rejection: ...
        gateFailure ??= { providerId, code: probe?.status === "timeout" ? "timeout" : "not-found", ... };
        emitTraceEvent(events, context, { type: "source:failed", ... });
      }

      if (cancelled && !streamReachabilityVerified) { /* return cancelled-exhausted */ }
      if (gateFailure) { failures.push(gateFailure); return createExhaustedResult(...); }
    }
```

Upstream context (same file): `let selectedStream = streams[0];` at line 167
— so a walk that probes nothing falls through with `streams[0]` unverified.
The inventory drop after the gate is `const liveStreams = streams.filter((stream) => !refusedStreamIds.has(stream.id));`
around line 305.

- `packages/providers/test/direct-stream-source.test.ts` — the existing suite.
  Harness: `createContext(fetchImpl, signal?)` (line 6) injects
  `context.fetch.fetch`; `createInput()` (line 16); a payload fixture
  `THREE_STREAMS` (line 30). Directly relevant existing tests:
  - `:76` "exhausts only when every probed candidate is definitively unreachable"
  - `:90` "a probed-and-refused stream is dropped from the shipped inventory"
  - `:113` "caps the probe walk instead of paying for every candidate" —
    asserts `probes <= 3` over 10 candidates. This test must keep passing.
  - `:136` "a cancelled resolve stops probing..." and `:166` abort-during-probe.

## Commands you will need

| Purpose              | Command                                                                                                                         | Expected on success                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Providers unit tests | `bunx turbo run test --filter=@kunai/providers --force`                                                                         | exit 0, all pass                             |
| Typecheck            | `bun run typecheck`                                                                                                             | exit 0                                       |
| Lint                 | `bun run lint`                                                                                                                  | exit 0 (17 pre-existing warnings = baseline) |
| Format your files    | `bunx oxfmt --write packages/providers/src/shared/direct-stream-source.ts packages/providers/test/direct-stream-source.test.ts` | no diff or formatted diff                    |

## Scope

**In scope** (the only files you should modify):

- `packages/providers/src/shared/direct-stream-source.ts` (the walk loop only)
- `packages/providers/test/direct-stream-source.test.ts` (one new test)

**Out of scope** (do NOT touch, even though they look related):

- `packages/providers/src/shared/resolve-gate.ts` — its `RESOLVE_GATE_MAX_PROBES = 2`
  feeds per-probe timeout division, a separate concern; changing it alters
  timing budgets.
- The `verifyCandidateStream` contract, `refusedStreamIds` semantics,
  cancellation handling, or `createExhaustedResult` — all proven by existing
  tests (`:90`, `:136`, `:166`); keep their behavior byte-for-byte.
- Anything outside `packages/providers/`.
- The commit message of `574e31882` — history; you are making the code match
  it, not editing it.

## Git workflow

- Branch: `advisor/003-probe-cap-accounting`
- Commit style: `fix(providers): probe budget counts probes, not candidate rows`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite the walk to spend budget per probe

Replace the `for (const candidate of streams.slice(0, RESOLVE_GATE_MAX_PROBES))`
header and add a counter. Target shape:

```ts
      let probesSpent = 0;
      for (const candidate of streams) {
        // A cancelled resolve must not keep spending probes, and must not be
        // recorded as a stream failure — the caller went away, the CDN is fine.
        if (context.signal?.aborted) {
          cancelled = true;
          break;
        }
        // Budget is measured in probes, not rows: a row without a url can
        // never be probed, so it must not eat the walk window.
        if (!candidate.url) continue;
        if (probesSpent >= RESOLVE_GATE_MAX_PROBES) break;
        probesSpent += 1;

        const verdict = await verifyCandidateStream({ ... });  // unchanged
        // ... everything from the abort re-check onward stays byte-for-byte ...
      }
```

Invariants to preserve (each is pinned by an existing test):

- Max calls to `verifyCandidateStream` per resolve = `RESOLVE_GATE_MAX_PROBES` (3) — pinned by `:113`.
- Abort **before** a probe breaks with `cancelled = true`; abort **during** a
  probe is handled by the existing post-await check — untouched.
- `gateFailure ??=` keeps the first rejection; `refusedStreamIds.add` only
  for probed-and-refused candidates; `verdict.accepted` still breaks with
  `selectedStream = candidate`.
- The `cancelled`/`gateFailure` post-loop handling stays exactly as is.

**Verify**: `bunx turbo run test --filter=@kunai/providers --force` → exit 0
(all existing tests pass, including the `probes <= 3` cap test).

### Step 2: Add the regression test that pins the fixed behavior

In `packages/providers/test/direct-stream-source.test.ts`, add a test next to
the `:113` cap test:

```ts
test("url-less rows do not consume the probe budget", async () => {
  // Rows 1-3 have no url (unprobed rungs) and row 4 is a live CDN. The cap
  // must be spent on real probes: with row-slicing, the three url-less rows
  // exhausted the walk window and the resolve fell through unverified (or
  // condemned live siblings after a refusal).
  let probes = 0;
  const result = await resolveDirectStreamSource({
    providerId: "vidlink",
    host: "vidlink.pro",
    label: "VidLink",
    input: createInput(),
    context: createContext(async (url) => {
      probes += 1;
      return url.includes("480") ? new Response("ok") : new Response("gone", { status: 404 });
    }),
    fetchPayload: async () => ({
      streams: [
        { qualityHint: "1080p" },
        { qualityHint: "720p" },
        { qualityHint: "720p" },
        { url: "https://cdn.example/480.mp4", qualityHint: "480p" },
      ],
    }),
    resolveGateProbe: true,
  });

  expect(probes).toBe(1); // only the one probeable row was probed
  expect(result.status).toBe("resolved");
  expect(result.streams?.[0]?.url).toBe("https://cdn.example/480.mp4");
});
```

**Shape notes**: rows without `url` must match the shape `normalizeStreams`
keeps — if the fixture's url-less rows are filtered out by normalization,
this test will see `probes === 0` and `status === "resolved"` with
`streams[0]` undefined-ish. Check `normalizeStreams` (same file) first; if it
drops url-less rows, build the fixture with url-less rows the way production
produces them (e.g. `url: ""` — see how `if (!candidate.url)` can be true)
and adjust the fixture accordingly. The `expect` values above are the target
semantics: **exactly one probe, resolved, the live rung selected** — if after
a correct implementation you cannot make them hold because normalization
removes url-less rows entirely, fall back to the second scenario from "Why
this matters": row 1 refuses (404), rows 2–3 url-less, row 4 live → expect
`status === "resolved"` (today it returns `exhausted`) with the live rung
shipped and the refused one dropped.

**Verify**: `bunx turbo run test --filter=@kunai/providers --force` → exit 0
with the new test passing. Then sanity-check the new test actually fails on
the old code: `git stash push -- packages/providers/src/shared/direct-stream-source.ts`
→ re-run the single file via `bun test packages/providers/test/direct-stream-source.test.ts`
from `packages/providers/` → the NEW test must FAIL → `git stash pop`.

### Step 3: Gates

Run typecheck + lint per the commands table.

**Verify**: both exit 0.

## Test plan

- New test: "url-less rows do not consume the probe budget" (or the
  refusal-plus-url-less fallback scenario) in
  `packages/providers/test/direct-stream-source.test.ts`.
- Existing tests that must remain green: `:76`, `:90`, `:113`, `:136`, `:166`
  — they pin exhaustion, inventory drop, the 3-probe cap, and both
  cancellation orderings.
- Pattern to follow: the file's own `createContext`/`createInput` harness.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n 'streams.slice(0, RESOLVE_GATE_MAX_PROBES)' packages/providers/src/shared/direct-stream-source.ts` → no matches
- [ ] `bunx turbo run test --filter=@kunai/providers --force` exits 0, including the new test
- [ ] The new test fails when Step 1's change is reverted (proven once via stash) and passes with it
- [ ] `bun run typecheck` exits 0; `bun run lint` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts don't match the live code (drift since `faf1afd22`).
- `normalizeStreams` proves url-less rows can never reach the walk (then the
  premise needs re-checking — report which of the two "Why this matters"
  scenarios still holds under the real data shape before writing the test).
- Any existing test in `direct-stream-source.test.ts` fails after a change
  you believe is semantically neutral — that test is pinning behavior the
  plan underestimated; revert and report rather than editing the assertion.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- After this lands, commit `574e31882`'s message bullet is finally true —
  no changelog edit needed (the message is history).
- `resolve-gate.ts`'s separate `RESOLVE_GATE_MAX_PROBES = 2` divides the
  per-probe timeout budget; if anyone unifies the two constants, timeout
  sizing changes with it. Deferred deliberately.
- A reviewer should check the probe-count increment can never run without a
  `candidate.url` and that no `continue` path skips the increment after a
  probe started.
- Follow-up deferred: audit-4's wider resolve-gate hardening (health
  recovery, latency ordering, hedge-delay calibration) is owned by
  `.plans/provider-resolve-hardening-handoff.md` — do not fold it in here.
