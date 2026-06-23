# Continue, Calendar, Diagnostics Feature Spine

Generated: 2026-06-23  
Updated: 2026-06-24 — Continue Hub collapsed into History Continue tab.

This is the next product lane after the continuation/media-action architecture sweep. The order is deliberate: History's **Continue tab** owns the user's next playback decision, Calendar explains upcoming/new releases, and Diagnostics explains why playback/provider/offline decisions behaved the way they did.

## Order

1. History Continue tab (supersedes dedicated Continue Hub)
2. Calendar Command Center
3. Diagnostics Lab
4. Shell/input cleanup and remaining architecture debt

## 1. History Continue tab

Goal: one continuation surface in History — resume, offline-ready, and in-progress rows on the Continue tab; new episodes and completed/tracked titles on their own tabs.

**Superseded:** the dedicated Netflix-style Continue Hub overlay (`ContinueHubShell`, `hubRows()`). Do not rebuild a parallel list surface.

What to build / maintain:

- `/continue` and the `continue` command open History with `initialFilterMode: "watching"` (Continue tab).
- Per-row action grammar from `ContinueWatchingService.titleDecision()` / `projectContinuation()`: badge, resume label, and Enter target share one projection.
- Local-vs-stream resolution via `continueSourcePreference` (`auto` | `local` | `stream` | `ask`) plus quiet `[l]` / `[s]` overrides when both sources exist on a row.
- `manage-offline` routes into the existing offline library / enrollment flows (no separate Hub).

Architecture requirements:

- Keep `ContinueWatchingService` as the sole continuation decision owner.
- Keep release reconciliation as freshness-only; convert release progress to continuation signals at the service boundary.
- Retire remaining `historyStore` continuation reads during D4. Use `historyRepository` for factual history reads and `ContinueWatchingService` for decisions.
- Frame/render tests for row badge/action consistency: badge and Enter target must come from the same decision (`history-view.test.ts`, `capture-history.tsx` Continue tab).

Regression surfaces:

- Startup `--continue`.
- History Continue tab Enter target and source overrides.
- Result badges.
- Offline-ready local playback.
- New-episode count and next target (New episodes tab).

## 2. Calendar Command Center

Goal: make Calendar the planning surface for tracked shows and new releases, not a second history classifier.

What to build:

- Week navigation with stable day groups and date headers.
- Tracked-only and all-release filters.
- Per-title follow/mute/queue/continue actions routed through `MediaActionRouter`.
- New episode indicators that match History Continue / New episodes for the same title.

Architecture requirements:

- Calendar should read release/schedule truth and call `ContinueWatchingService` projections for playback intent.
- Calendar Enter/continue actions must use the same `continueSourcePreference` resolution as the History Continue tab.
- Do not duplicate continuation classification in calendar UI models.
- Keep release cache writes in reconciliation/calendar services, not render components.

Regression surfaces:

- Calendar input focus and Escape/back behavior.
- Date grouping and time zone display.
- New-episode count drift against History.

## 3. Diagnostics Lab

Goal: make provider/offline/continue decisions explainable without exposing raw URLs or making users read logs.

What to build:

- Decision timeline for: startup `--continue` → Continue tab row decision (`titleDecision`) → source resolution (`continueSourcePreference` → primary/secondary action) → provider resolve → offline fallback → post-play.
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

Do next after the feature spine is stable (Phase 1–2b of Continue collapse are landed):

- D4: retire `historyStore` adapter and container wiring.
- Commit 6: finish workflow family extraction for offline library, download, settings, then shell action routing.
- Commit 7: split `ink-shell.tsx` by behavior-covered surfaces.
- Central input routing: reduce local `useInput` sites and make Escape/back stack behavior a tested state-machine rule.
- Poster resize cleanup: verify terminal image placement cleanup across history, calendar, browse, playback, and post-play rails.
