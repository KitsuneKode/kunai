# Offline terminal playback qualification

Captured 2026-10-04 (Asia/Calcutta) on Linux using the real `apps/cli/src/main.ts`
under tmux and installed mpv with null audio/video outputs. The shadow profile
contained two owned eight-second MP4 files, recorded against a deliberately
unregistered provider (`retired-provider`). HOME/XDG/APPDATA were isolated.
This proves the desktop local playback path; it does not qualify physical phones,
visible video/audio, macOS, Windows, live providers, or store submissions.

## Reproductions and repairs

1. The one-shot player unconditionally ran HTTP preflight against a local file.
   A rejected preflight terminated mpv before IPC progress. The launcher regression
   failed for explicit local authority and passed for HTTP rejection controls.
   Both player paths now skip HTTP preflight only for an admitted local target.
2. mpv cleared duration at EOF while retaining position. An eight-second completion
   rendered successfully but persisted no history. Before/after EOF reset tests
   failed; a remote premature-EOF test also exposed guard bypass. Both result
   assembly and EOF checks now retain the observed playback-cycle duration.
3. Local Tracks mapped an empty provider inventory and rendered no file facts.
   A registry-free local-data test failed. The panel now has its own disabled
   downloaded-file source group and uses the current source label.

## Actual user path and witnesses

Library → title → E1 → real mpv → Post-play → Tracks → back twice → Episodes
→ E2 → real mpv → Post-play. The pane and SQLite were captured together.
The final implementation also adds `Tracks: player controls` to the source detail;
that copy was added after the captured Tracks pane below.

Exact frame witnesses (mechanically matched in the captured files):

- Library: `1 title · 2 local items · local-only`
- Tracks: `Local file`, `Downloaded file`
- Post-play picker: `Episode 1  ↓ offline  ✓`, `Episode 2  ↓ offline`
- Final Post-play: `✦ SERIES COMPLETE`, `2 episodes · 1 season`

Read-only SQLite witnesses for `tmdb:777`:

| Season | Episode | Position | Duration | Completed | Provider provenance |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 8 | 8 | 1 | retired-provider |
| 1 | 2 | 8 | 8 | 1 | retired-provider |

The captured config has `analytics: disabled` and an empty `installId`.
No profile data was copied back. The task-owned terminal session was stopped.

## Regression evidence

`bun run --cwd apps/cli test:file` on the player-stats, Tracks data, and overlay
model suites: RED **20 pass / 5 fail** before the final repairs. Those suites plus
native launcher integration and mpv unit tests: GREEN **55 pass / 0 fail**.
The POSIX launcher fixture is explicitly skipped on Windows; portable URL-policy
checks still cover POSIX paths, Windows paths and file URLs.

The full forced test, typecheck, lint and build receipts accompany the PR.
Real-terminal bundles remain under the task-owned temporary evidence directory:
`/tmp/kunai-full-review-20261003/offline-real-{history,picker,tracks,e2}-green`.
They are local evidence rather than publicly hosted artifacts.

## Follow-up observations

The Tracks panel has two navigation levels: Escape returns from options to
sections, then Escape closes it. The first wait used only one Escape and timed out;
following the actual reverse path succeeded. The session harness also has a boot
predicate that expects a Kunai header even when an already-open Library frame
omits it, and needs a leading space when passing `--offline` as `--command`.
Those harness usability issues remain outside this playback fix.
The short-clip post-play frame still has overlapping title text and acquisition
wording that should be adapted for local playback in a separate UI pass.
