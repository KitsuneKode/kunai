# Plan: Re-land what the abandoned PR stacks still carry

> **Drift check (run first):** for each row below, grep the tree for the named
> behaviour before porting it — some residue may land through other work. The
> source commits stay reachable on their `origin/*` branches until those
> branches are deleted; cherry-pick them for reference, never for the merge.

## Status

- **Status:** PARTIAL — the 2026-10-07 integration (`integrate/backlog-20261007`)
  landed 30 PRs as merge commits: #530–#538, #553–#569 and #573–#576.
  This plan now owns only the residue of the stacks that were **not** merged.
- **Priority:** P1 for the security and playback rows, P3 for the rest
- **Effort:** M overall; each row is S–M on its own
- **Risk:** MED — re-implement against the current tree, do not merge the old
  heads: they conflict in 18–73 files because #565, #572 and #573 re-did much
  of the same audit work differently.

## Why the stacks were not merged

Stack A (#501→#506), stack B (#508→#545) and #507 were written against
`main@e509732` or older. Their commits depend on each other (a #528 watchdog
fix assumes #528's slow-open commit, which assumes #508's transport), so
cherry-picking one fix drags in a chain of prerequisites. Porting player
watchdog behaviour without them in the most important code path is how
regressions ship. Each row below is a behaviour to re-implement, with the
commit that first wrote it.

## Residue

### Security and trust (P1)

| Behaviour                                                                                                                      | Source                    | Note                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| mpv refuses private literal hosts (`169.254.169.254`, RFC1918, loopback) for every `http(s)` target, remote **and** local kind | `35a661186` (#543) + #525 | Needs a decision for the real-mpv tier, which serves media from `127.0.0.1`; an env bypass on a security check is not acceptable |
| Vet manifest-embedded and deferred-media targets mpv fetches                                                                   | `9f03f01c7` (#543)        | Same boundary as the row above — land together                                                                                   |
| yt-dlp option list terminated with `--` before the watch URL                                                                   | `35a661186` (#543)        | Small; matches the curl convention                                                                                               |
| Walk miruro curl redirects in-process so each hop is vetted                                                                    | `b88bc3655` (#543)        | The `-q` half landed (`curlArgvHead`); the redirect walk needs #508's transport or a local equivalent                            |
| Pin every CI action to a SHA; add dependency monitoring                                                                        | #523                      | `release.yml` still uses tags                                                                                                    |
| Typed 403 for Cloudflare-gated fetches; dead deferred streams keyed by content, not locator                                    | `#541`                    |                                                                                                                                  |

### Playback reliability (P1)

| Behaviour                                                                     | Source             |
| ----------------------------------------------------------------------------- | ------------------ |
| Narrate slow opens instead of labelling them stalls                           | `04bc4ecd4` (#528) |
| Keep watchdog-triggered reconnects alive through the replaced file's end-file | `c48f6465f` (#528) |
| Reconnect on no-progress stalls, not only cache verdicts                      | `3e1006584` (#528) |
| Stop ipc-stalled stalls and late init replies polluting stats                 | `05016b78b` (#528) |
| Cap decode and bandwidth ceilings on low-spec hosts                           | `4d36ee292` (#528) |
| Sweep stale mpv IPC sockets and orphan confs on startup                       | #544               |
| Bound wedged downloads by output liveness                                     | #544               |
| Settle picker and bridge waiters when workflows dismiss overlays              | `fed7882d8` (#528) |

### UX (P2)

| Behaviour                                                                     | Source |
| ----------------------------------------------------------------------------- | ------ |
| Press-again confirmation for destructive actions; focus-aware input ownership | #505   |
| Watched-download cleanup review and OS notifications                          | #504   |
| Overlay and palette actions act on the item the user chose                    | #528   |
| Doctor writability probe; details-card overlap; honest catalog failures       | #503   |

### Structure and features (P3, separate stack)

- Browse-shell hook extractions — `useCommandPalette`, `useIdleSurface`,
  `useResultNarrow`, `useBrowseOverlay` (#513, #515, #517, #519). Redo against
  today's `browse-shell.tsx`; it changed too much to rebase onto.
- Provider transport overhaul, endpoint resilience with Retry-After,
  `ProviderQueryCache`, relay envelope validation (#508–#511).
- SGR mouse input foundation (#521) — a feature, not a fix.

### Closed without residue

- #500 — resolve-gate coverage is now derived from `PROBES` (#565/#566).
- #306 — no diff against `main`.
- #520, #522 — #569 refuses `completed:true` for crashes and kills.
- #501 — config save serialization and cross-instance locking landed in #573;
  `--offline` is honoured.

## Acceptance

- Each row lands as its own PR from `main`, with a test that fails before it.
- The security rows land before the next release that ships new providers.
- Delete this plan when the tables are empty; move it to `.archive/plans/`.
