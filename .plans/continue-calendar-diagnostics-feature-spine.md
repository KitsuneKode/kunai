# Continue, Calendar, Diagnostics Feature Spine

Generated: 2026-06-23

This is the next product lane after the continuation/media-action architecture sweep. The order is deliberate: Continue owns the user's next playback decision, Calendar explains upcoming/new releases, and Diagnostics explains why playback/provider/offline decisions behaved the way they did.

## Order

1. Continue Hub
2. Calendar Command Center
3. Diagnostics Lab
4. Shell/input cleanup and remaining architecture debt

## 1. Continue Hub

Goal: make "continue watching" feel like one Netflix-style surface backed by one decision owner.

What to build:

- A dedicated Continue surface that groups resume, offline-ready, new episodes, new seasons, and up-to-date tracked titles.
- Online/offline source switching where downloaded media is treated as a first-class source option, not a separate dead-end library.
- Clear per-row action grammar: resume local, resume online, play next, switch source, queue, mark watched/unwatched.
- New-episode and tracked-title emitters that come from `ContinueWatchingService`/release reconciliation, not ad hoc UI classification.

Architecture requirements:

- Keep `ContinueWatchingService` as the continuation decision owner.
- Keep release reconciliation as freshness-only; convert release progress to continuation signals at the service boundary.
- Retire remaining `historyStore` continuation reads during D4. Use `historyRepository` for factual history reads and `ContinueWatchingService` for decisions.
- Add frame/render tests for row badge/action consistency: badge and Enter target must come from the same decision.

Regression surfaces:

- Startup `--continue`.
- History Enter target.
- Result badges.
- Offline-ready local playback.
- New-episode count and next target.

## 2. Calendar Command Center

Goal: make Calendar the planning surface for tracked shows and new releases, not a second history classifier.

What to build:

- Week navigation with stable day groups and date headers.
- Tracked-only and all-release filters.
- Per-title follow/mute/queue/continue actions routed through `MediaActionRouter`.
- New episode indicators that match Continue Hub for the same title.

Architecture requirements:

- Calendar should read release/schedule truth and call continuation projections for playback intent.
- Do not duplicate continuation classification in calendar UI models.
- Keep release cache writes in reconciliation/calendar services, not render components.

Regression surfaces:

- Calendar input focus and Escape/back behavior.
- Date grouping and time zone display.
- New-episode count drift against History/Continue.

## 3. Diagnostics Lab

Goal: make provider/offline/continue decisions explainable without exposing raw URLs or making users read logs.

What to build:

- Decision timeline for startup continue, source selection, provider resolve, offline fallback, and post-play.
- User-readable support bundle preview.
- Health rows for provider work lanes, memory guard, poster rendering, and mpv process cleanup.

Architecture requirements:

- Diagnostics consumes existing event/correlation data; do not let diagnostics trigger provider work unless explicitly requested.
- Add missing timing events for mpv release, prefetch handoff, catalog warmup, and post-play first paint.
- Keep sensitive values redacted at source.

Regression surfaces:

- Provider resolve latency.
- Support bundle privacy.
- Background worker fan-out.
- Terminal render responsiveness.

## 4. Remaining Architecture Debt

Do next after the feature spine is stable:

- D4: retire `historyStore` adapter and container wiring.
- Commit 6: finish workflow family extraction for offline library, download, settings, then shell action routing.
- Commit 7: split `ink-shell.tsx` by behavior-covered surfaces.
- Central input routing: reduce local `useInput` sites and make Escape/back stack behavior a tested state-machine rule.
- Poster resize cleanup: verify terminal image placement cleanup across history, calendar, browse, playback, and post-play rails.
