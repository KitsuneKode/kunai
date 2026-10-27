# Watching UX coherence

Status: IMPLEMENTED; ready for local manual qualification. Baseline: f8e8de559. Scope: the user-reported first-run,
browse/filter, resolve/start, now-playing, Tracks and share/back journey.

## Spec and direction

The October 23 screenshot report is the spec: stop false startup stall alarms;
show real progress without fabricated delays; make selected/focused/applied states
distinct; expose Auto quality and one subtitles Off choice; preserve unrelated
preferences through provider/source/quality changes; reduce repeated text and
diagnostic noise; make visible controls clickable and keyboard reachable; repair
filtering, navigation and sharing. Existing Sakura/Ember Dusk tokens and the Ink
renderer remain authoritative. No OpenTUI/framework migration or web libraries.

Intent: someone wants to find an episode and watch it without interpreting
provider internals. One task leads per view. Bright bold title, rose focus band,
checkmark for applied selection, restrained neutral metadata. Compact terminal
spacing; narrow layouts preserve control labels and actions. No motion/delays on
keyboard navigation. Loading is live state, never simulated progress. Unknown
quality/health stays unknown. Diagnostics remain available separately.

## Implementation

1. Playback truth and presentation: trace startup/cache/pause/watchdog signals;
   reproduce false stall and stale feedback; fix state transitions without
   weakening real stall recovery. Simplify resolve/now-playing progress and hints,
   preserve title/episode and accurate network/subtitle state. Own loading-shell,
   playback presenter/status/watchdog/mount and their tests.
2. Tracks and preference isolation: compact provider/source rows, visible focus,
   applied glyph, useful media facts, accessible Off first, honest Auto semantics;
   fixed column separation and narrow windows. Trace every pick to runtime and
   persistence, preserving unrelated subtitle/audio/quality preferences. Own
   Tracks models/rendering/nav and selection services, regression tests.
3. First-run: coherent reachable steps, accurate progress, concise footer, visible
   Back and pointer support for profile/audio/subtitle choices. Keep explicit
   keystroke-only analytics consent intact. Own setup screens/controller/workflow.
4. Shell navigation and filters: actually filter palette choices as text changes,
   wire click selection/activation to the same keyboard path; visible Back and
   Share where useful, clear provider entry point, fix covered-input leaks.
   Inspect existing protocol registration before adding any launcher machinery.
5. Integrate and review; exercise realistic long titles/server names, missing and
   single quality, many subtitles, failure/loading/empty and narrow states. Verify
   real terminal plus persisted isolated state and advancing real-mpv playback.

## Constraints and skills

Apply requested interface-design, better-interface (all six owning domains),
better-layout/accessibility, make-interfaces-feel-better, interaction-design,
animate and apple-design principles in terminal cells and semantic tokens.
break-ui supplies dev/test worst-case fixtures; narrow-react-prop-types applies
only where live callers justify tightening. vercel-react-best-practices informs
subscription/render performance. pick-ui-library, opentui, design-taste-frontend,
beautiful-shadows and good-css were considered: preserve Ink and shared tokens;
DOM/CSS/shadow/browser inspection recipes do not apply to the shipped TUI.
improve-animations/find-animation-opportunities are advisory only; do not add
decorative motion or delay interactions. verify-kunai supplies the real-terminal
and real-mpv proof. No REA needed unless a runtime protocol gap requires it.

Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA and file credentials.
Never write the real profile. Preserve all other worktrees and active provider
rewrite. No remote merge, release publication or OS registration in the real
profile. Linux protocol registration can be verified in a sandbox; daemon only
if a demonstrated requirement cannot be met by existing protocol handler.

## Acceptance

Meaningful failing-first regressions for false alarms, preference side effects,
pointer/filter routing; inspect rendered frames at supported narrow/regular/wide
sizes with long and non-Latin values. Per-package checks during work; final forced
types/lint/tests/build plus fmt and doc paths/frontmatter/coverage. Record exact
SHA, commands, evidence and platform/live-provider limits in the release report.

## Local implementation evidence

The source now resets watchdog state per file, treats initial starvation as
buffering, preserves session subtitle/quality choices, exposes Auto, fixes Tracks
cell budgets, wires setup/palette/Back/Share pointer targets and narrows palette
prefix queries. The active Ink/theme stack is retained.

Failing-first regressions cover watchdog startup/reset, palette prefixes, provider
subtitle defaults despite Off, source quality preference, and long source rows
exceeding their height at 72 columns. Pointer and integration tests cover consent,
late acknowledgements and the reverse paths. All six setup screens were exercised
in an isolated real 72×24 terminal. Movie-profile and French-subtitle pointer picks
persisted only to the movie profile; analytics stayed disabled with an empty id.
The real-mpv tier passed with advancing IPC position and SQLite history.

Final forced checks and review results belong in the candidate qualification
record, not a duplicate implementation checklist here. Linux protocol registration
already exists; no daemon or implicit OS registration was added. Live provider,
physical-device and hosted-platform qualification remain separate release gates.

The source is committed at `fc2f4604f`. Forced root tests pass (9458 pass, 62 skip),
with types/lint/build/format/docs and host binary smoke passing. Fresh Sol review
found no actionable findings; its independent tests and dependency limits are
recorded in `.release/watching-candidate-2026-10-22.md`. Remaining work for this
plan is manual acceptance of the user-reported watching journey and platform/live
qualification before any merge/release decision.
