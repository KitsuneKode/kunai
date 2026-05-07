# Download, Offline Library & Onboarding Wizard — Design Spec

**Date:** 2026-05-07  
**Status:** Approved  
**Scope:** In-session downloads via ffmpeg, offline library mode, feature-gated onboarding wizard, startup notification rail

---

## Code Principles (standing)

Every file touched by this work must adhere to these:

- **DRY** — no duplicate logic. Extend existing code before writing new.
- **Separation of concerns** — each unit has one clear purpose.
- **Good naming** — functions and types are self-documenting and readable.
- **Non-additive** — reuse or tweak existing functions; never create a parallel version.
- **Single source of truth** — two owners for the same behavior is a design smell.
- **Maintainability** — optimize for the next reader, not for cleverness.

---

## 1. Architecture Overview

Four layers, each independently understandable and changeable:

```
┌─ OnboardingWizard ──────────────────────────────────────────────┐
│  First-run detection → dependency checks → opt-in features      │
│  → capabilities summary. Writes to config. Re-run via --setup.  │
└──────────────────────────────────────────────────────────────────┘
         ↓ unlocks
┌─ FeatureGate ───────────────────────────────────────────────────┐
│  Lazy check at point-of-use. Returns { enabled, reason }.       │
│  No UI — callers decide presentation.                           │
└──────────────────────────────────────────────────────────────────┘
         ↓ powers
┌─ DownloadService ───────────────────────────────────────────────┐
│  Background queue. ffmpeg child processes. SQLite state.        │
│  Progress events. File management. Survives session restart.    │
└──────────────────────────────────────────────────────────────────┘
         ↓ feeds
┌─ OfflineLibraryPhase ───────────────────────────────────────────┐
│  Reuses episode picker. Sourced from DB not TMDB.               │
│  Entered via soft offline detection or explicit --offline flag. │
└──────────────────────────────────────────────────────────────────┘
```

These layers communicate downward only. `OfflineLibraryPhase` has no knowledge of ffmpeg. `DownloadService` has no knowledge of the wizard. `FeatureGate` has no UI.

---

## 2. Onboarding Wizard

### Trigger

Runs once, before `SearchPhase`, when `config.onboardingVersion` is absent or below the current wizard version. Re-run at any time via `kunai --setup`.

### Steps

1. **Welcome** — one screen explaining what kunai is. Press enter to continue.

2. **Dependency check** — detects `mpv` and `ffmpeg` via `Bun.which`. Shows pass/fail per dependency with inline install hint.
   - `mpv`: required. Wizard blocks on missing mpv.
   - `ffmpeg`: recommended. Missing ffmpeg disables downloads; user can continue without it.

3. **Opt-in features** — toggleable checklist written to config:

   | Feature                     | Default |
   | --------------------------- | ------- |
   | Downloads (requires ffmpeg) | off     |
   | Subtitles                   | on      |
   | Auto-skip intros/outros     | **off** |

4. **Download location** — shown only if downloads are enabled. Default: OS cache dir (`<cacheDir>/kunai/downloads/`). User can override. Written to `config.downloadPath`.

5. **Shell completion** — optional step. Generates `_kunai` zsh completion file, writes to `~/.zsh/completions/`. Skippable. Covers all flags: `--offline`, `--debug`, `--download`, `-S`, `-i`, `-t`, `-a`, `--setup`, `--completion`. Also available standalone: `kunai --completion zsh`.

6. **Capabilities summary** — full-screen list of what is enabled vs what could be unlocked. No upsell language — honest capability listing. Green for active, dimmed for available-if-installed.

### Config fields written

```json
{
  "onboardingVersion": 1,
  "features": {
    "downloads": false,
    "subtitles": true,
    "autoSkip": false
  },
  "downloadPath": "<cacheDir>/kunai/downloads/",
  "suppressOfflinePrompt": false
}
```

---

## 3. FeatureGate

```ts
type FeatureId = "downloads" | "autoSkip"

interface GateResult {
  enabled: boolean
  reason?: string   // human-readable if not enabled
}

FeatureGate.check(feature: FeatureId): GateResult
```

At point-of-use (e.g. pressing `D` to download without ffmpeg):

```
Downloads require ffmpeg — run kunai --setup to enable
```

No crash, no modal, just inline feedback. The gate does not know how the result is rendered.

---

## 4. Notification Rail

A single persistent line rendered at the top of the Ink shell. One notification visible at a time; additional notifications queue. Auto-dismisses after 6 seconds or on any keypress.

**Notification types:**

| Event                 | Message                                                                                           | Behaviour                                   |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| New version available | `kunai v1.x available — <install command>` (resolved by implementer based on distribution method) | Auto-dismiss                                |
| Download complete     | `Attack on Titan E04 saved`                                                                       | Auto-dismiss                                |
| Network unavailable   | `Network unavailable — press L for library` + `[×] Don't ask again`                               | Persists until dismissed or network returns |
| Download failed       | `Attack on Titan E04 failed (attempt 2/3)`                                                        | Auto-dismiss                                |

**Version check:**

- Runs in background after shell renders — never before.
- Checks npm registry (or GitHub releases API) with a 3s timeout. Drops silently on failure.
- Only re-checks if `>24h` since `config.lastUpdateCheck`.
- No auto-update. Surfaces install command in the notification.

---

## 5. DownloadService

### Responsibilities

Manage the ffmpeg child process queue, persist job state to `kunai-data.sqlite`, emit progress events. Nothing else.

### Queue

Singleton instantiated in `SessionController`. Default concurrency: **2 parallel ffmpeg processes**. Configurable. Jobs are persisted to SQLite so state survives session restart.

### Job lifecycle

```
queued → preflight → downloading → done
                   ↘ failed (retries up to 3)
                   ↘ aborted
```

- **preflight:** HEAD request for `Content-Length`. Surfaces size estimate to user before download starts. HLS shows "size unknown" honestly.
- **downloading:** `Bun.spawn(["ffmpeg", ...])` with `-progress pipe:1`. stdout parsed into `{ bytesWritten, elapsed, percent? }` and emitted as events.
- **done:** file path written to DB, `isDownloaded` set for episode.

### ffmpeg invocation

```
ffmpeg
  -headers "Referer: <value>\r\nUser-Agent: <value>\r\n"
  -i "<stream_url>"
  -c copy
  -progress pipe:1
  -loglevel error
  "<output_path>.tmp.mp4"
```

On clean exit: rename `.tmp.mp4` → `.mp4`. A crash or kill never leaves a valid-looking corrupt file. Subtitle: plain HTTP GET of subtitle URL written alongside as `<name>.en.vtt` after video completes.

### File naming

```
<config.downloadPath>/<titleSlug>/<titleSlug>-S<ss>E<ee>-<qualityLabel>.mp4
```

- Spaces → dashes, special chars stripped.
- Collision: append `.1`, `.2`, etc.

### Confirm before download

Before ffmpeg starts, a one-line prompt shows:

```
Attack on Titan E04 · 1080p · ~680 MB → /cache/kunai/downloads/... [y/n]
```

If the size is unknown (HLS): `· size unknown` is shown honestly. If user declines, job is dropped without touching disk.

### Abort

`DownloadService.abort(jobId)`:

1. Kill ffmpeg subprocess.
2. Delete `.tmp.*` file.
3. Mark job `aborted` in SQLite.

### Quit prompt

On `SIGINT`/quit with active downloads:

```
2 downloads in progress
  [K] Keep downloading in background
  [W] Wait for completion
  [X] Cancel all and quit
```

**Keep in background:** calls `subprocess.unref()` on each active ffmpeg process, writes final state to SQLite, exits cleanly. ffmpeg processes continue running detached.

**Reconciliation on next launch:** check SQLite for jobs in `downloading`/`queued` state. For each: inspect file — if complete (non-`.tmp.*`, non-zero) mark `done`; if `.tmp.*` partial, mark `failed` and offer re-download.

### Retries

`retryCount` per job, max 3. On non-zero ffmpeg exit: re-queue with backoff — 10s, 30s, 90s. After 3 failures: mark `failed`, emit notification.

### SQLite schema (download_jobs table)

```sql
CREATE TABLE download_jobs (
  id          TEXT PRIMARY KEY,
  title_id    TEXT NOT NULL,
  title_name  TEXT NOT NULL,
  episode     INTEGER,
  season      INTEGER,
  quality     TEXT,
  stream_url  TEXT NOT NULL,
  headers     TEXT NOT NULL,   -- JSON
  output_path TEXT,
  file_size   INTEGER,         -- bytes, null until preflight
  status      TEXT NOT NULL,   -- queued|preflight|downloading|done|failed|aborted
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

---

## 6. OfflineLibraryPhase

### Offline detection (lazy, non-aggressive)

No startup probe. Detection fires only when `SearchService` returns a network error. At that point the notification rail shows:

```
Network unavailable — press L for your library, or keep trying  [×] Don't ask again
```

`[×] Don't ask again` writes `suppressOfflinePrompt: true` to config. User is never auto-switched into offline mode.

### Entry points

All three converge at the same `OfflineLibraryPhase`:

1. `kunai --offline` flag
2. `L` hotkey anywhere in session
3. Notification rail prompt after search failure

### Flow

```
LibrarySearch  (filter downloaded titles by name, sourced from SQLite)
    ↓
Title selected → episode list from download_jobs
    ↓
Episode picker  (same component, source prop: "remote" | "local")
  · done episodes:    playable
  · failed/aborted:   dimmed, shows status label
  · in-progress:      shows download progress inline
    ↓
Play → validateLocalFile(jobId) before launching mpv
  · missing or .tmp.*: inline error, offer re-download
    ↓
D key → delete prompt  ("Free 680 MB? [y/n]")
```

### Shared episode picker

The existing episode picker takes a `source: "remote" | "local"` prop. Same component, same keys, same scroll. `isDownloaded` indicators from the online flow work identically here. No forked component.

### File validation

`DownloadService.validateLocalFile(jobId)`:

1. File exists at recorded path.
2. Does not end in `.tmp.*`.
3. Size > 0 bytes.

Returns `{ valid: boolean, reason?: string }`. Called before every local playback. Failures surface inline at episode level — no crashes.

---

## 7. What is Not in Scope

- Daemon process for background downloads (deferred to `.plans/kunai-architecture-and-cache-hardening.md`)
- YouTube provider downloads (deferred to `.plans/yt-provider.md`)
- DASH stream support (ffmpeg handles it technically, but provider support is per-provider)
- Download queue persistence across machines
- Thumbnail embedding or metadata tagging in output files
