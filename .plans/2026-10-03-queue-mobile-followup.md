# Queue, offline, and phone experience follow-up

Status: unfinished. This records the user's computer-off, privacy-first phone
requirement and the remaining decisions; it does not claim a web companion,
native app, installer, or store release exists.

## Decision and recommended order

The phone must be useful with the personal computer off. A desktop companion
is optional. Prefer one shared identity/action/state contract with separate
terminal and touch presentations; do not build four new clients simultaneously.

1. Close real playback and request-profile gaps before adding more screens.
2. Present truthful current/starting/upcoming state, exact queue identity, and
   explicit post-play actions. Never consume an item merely because VLC opened.
3. Complete provider-independent offline playback, then qualify restart,
   cancellation, insufficient space, missing sidecars, and resume.
4. Reduce phone setup with a reviewed download and host launcher, then choose
   the common touch frontend after one real source works on each phone.
5. Add broader playlist conveniences and optional local recommendations after
   reliable first playback and offline continuity. A local model must not become
   an install prerequisite, analytics opt-in, or autonomous download trigger.

The source-backed [no-store comparison](../.reference/reviews/2026-10-03/mobile-no-store-options.md)
covers Home Screen web UI, on-phone host adapters, existing-app integration,
and optional desktop access. The remaining material decision is whether a
**user-owned always-on descriptor server** is acceptable or every resolver
operation must execute on the phone. A descriptor server needs a new bounded,
authorized API and returns metadata only; media remains direct. Neither option
is implemented or physically qualified.

## Concrete source observations

The queue overlay used to label its first unplayed row `playing`, regardless
of its persisted status. Pending work now reads `up next`; an in-flight claim
reads `starting`. Queue consumption is confirmed playback startup, not watched
completion. A future Now Playing surface needs live player state and the exact
active intent, not the first pending row.

On 2026-10-03 at source snapshot
`6dd035443a52f75bfa332c10b556371b55e0248c`, fresh default-route signoff from
this host found:

| Case                             | Provider | Result                                                    |
| -------------------------------- | -------- | --------------------------------------------------------- |
| Dune, TMDB 438631                | VidLink  | No stream; subsequent resolve reported `not-found`        |
| Dutton Ranch S01E01, TMDB 299167 | VidLink  | Resolved and reachable using the supplied request profile |
| Onigiri E01, provider search     | HiAnime  | Resolved and reachable using the supplied request profile |

Independent bounded GETs to the latter two URLs **without headers/cookies**
returned HTTP 403. This is a concrete incompatibility with the current
URL-only phone preview, not evidence of universal provider outage. A desktop
probe with headers, or selecting another media player, cannot by itself prove
phone request parity. See the URL-free
[signoff](../.reference/reviews/2026-10-03/provider-signoff-followup.json) and
[phone comparison](../.reference/reviews/2026-10-03/phone-provider-compatibility.json).
No stream URL, cookie, or header value is retained in those files.

## UI contracts to implement next

Keep these separate in both desktop and future touch interfaces:

| Surface         | Owns                                       | Required visible actions and states                                                                     |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Now Playing     | Real active player session and destination | Current title/episode, paused/buffering/error, resume/seek where observable                             |
| Up Next         | Current watch intent                       | Next/end placement, reorder/remove/clear, starting, failed-start retry, explicit crash restore          |
| Playlists       | Durable saved collections                  | Create/name/add/remove/reorder/import/export; load into Up Next explicitly                              |
| Downloads       | Acquisition jobs                           | Confirm intent/profile/destination, queued/running/deferred/failed, retry/cancel/repair, storage reason |
| Offline library | Validated owned artifacts                  | Available here versus elsewhere, missing/repairable, local resume, explicit deletion                    |
| Post-play       | Actual playback outcome                    | Resume/replay, next item, source recovery, recommendations, return to browse                            |

The existing implementations already provide substantial parts of these
actions; this is the acceptance model for completing integration, not a claim
that they must all be rebuilt. Both anime and TMDB identity must survive each
action. External VLC handoff supports manual return/next unless a verified
progress/completion event contract is added.

For a networked companion, use service-owned read models and typed mutations,
per-device pairing/revocation, Host/Origin validation, bounded bodies and rates,
and idempotent mutations. Avoid direct database access from UI, shell command
strings, arbitrary paths/URLs, wildcard CORS on a control API, and a shared
media proxy. Browser caches can hold the UI and metadata; that is not downloaded
video. Phone background downloads and browser storage need separate gates.

The [existing offline plan](offline-provider-independent-playback.md) owns
retired-provider durability. This review does not duplicate or close that plan.
The [production review](2026-10-03-production-review.md) retains the wider
network trust, process teardown, publishing, and release-platform blockers.

## Device preparation and useful evidence

The user's Android and iPhone already have the chosen terminal hosts and VLC.
Use the prepared device-kit ZIP for developer qualification. USB/Files or
LocalSend transfers it; Android execution belongs in private Termux storage,
and iPhone execution requires all five helpers in one a-Shell mini directory.
Follow the [device lab](../.docs/mobile-device-lab.md).

The [public owned fixtures](../.reference/reviews/2026-10-03/phone-fixtures/README.md)
remove the need for a personal HTTPS server for the initial host/VLC check.
They are generated test patterns, not real-provider evidence. The artifact
set digests remain those of the device-kit metadata. Record help/version
return, input/cancellation, bounded HTTPS, state recovery, accepted handoff,
and visible playback separately. No physical row is complete yet.

After the baseline succeeds, re-resolve compatible real-provider sources
privately and test on both phones. Keep URLs out of evidence, screenshots,
diagnostics, issues, and commits. A failure must identify its boundary rather
than be recorded as a successful launch.

## Verification record for the queue correction

The two display suites reproduced seven failing assertions before the change.
Queue view, rendered 72/100/140-column frames, claims, startup rollback,
post-play, and lifecycle tests then passed: **33 tests, zero failures**.

Fresh complete verification: **8,100 passed, 60 skipped, zero failed**;
26 Turbo tasks, none cached. Typecheck (15 tasks), lint (14 tasks, zero errors),
formatting, document paths, and CLI build (10 tasks) passed uncached where
applicable. The first complete run timed out in the unchanged concurrent-version
installer test: 8,099 passed, 60 skipped, one failed. The isolated case passed,
all 93 installer cases passed, and the repeated full suite passed. No timeout
was raised and no installer runtime change was made; the one observed hang is
not diagnosed as resolved by the queue correction.

React Doctor 0.9.14 against the exact base reported zero new errors or warnings;
telemetry and score submission were disabled. Refreshing the tool through Bunx
did not finish, so this comparison used the same isolated cached version as the
earlier audit rather than claiming a newly fetched version or a health score.

The generated H.264/AAC fixture decoded locally with mpv. That does not prove
Android/iPhone playback. Required hosted checks and physical observations are
separate from these local results.
