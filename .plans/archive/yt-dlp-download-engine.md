# yt-dlp Download Engine & CLI UX Overhaul

## 1. The Strategy: Single Source of Truth

Kunai spawns **`yt-dlp` only** for the download queue; no alternate first-party download CLIs.

### Why yt-dlp only?

1. **It Does It All:** `yt-dlp` natively handles HLS (`.m3u8`) with built-in concurrent fragment downloading. It also handles raw `.mp4` downloads flawlessly.
2. **Piped Responses:** By using the `--newline` flag, `yt-dlp` guarantees a standardized, line-by-line progress output `[download]  45.0% of 1.2GiB at 5.0MiB/s ETA 00:30`. This is vastly superior and more predictable than ad-hoc progress parsing from a generic fragment downloader.
3. **No Fallback Hell:** Multiple download engines fragments the codebase and complicates error handling. A single, robust engine ensures consistency and simplifies debugging.

### The Global Quality Preset

Instead of asking for the download quality on every single episode, the CLI will use a global configuration (e.g., `defaultDownloadQuality: "1080p"`, stored via the `/setup` wizard or config). The system will automatically select the best matching stream that satisfies this preference, creating a frictionless one-click queuing experience.

## 2. Execution Phases

### Phase 1: Core Engine Migration

- **Capability Check:** `resolveDownloadFeatureState` requires `yt-dlp` when downloads are enabled; optional `ffprobe` for artifact validation (see `CapabilitySnapshot` / `/setup`).
- **Engine Implementation:** `executeYtDlpDownload` in `DownloadService.ts` (landed).
  - **Command Args:** `["yt-dlp", "--concurrent-fragments", "16", "--newline", "--add-header", "Referer: <ref>", "-o", "<tempPath>", "<streamUrl>"]`
  - **Progress Parsing:** Implement a Regex to extract percentage from the `--newline` stdout and pipe it directly to `deps.repo.updateProgress()`.
  - **Artifact Validation:** Maintain the `ffprobe` verification step for the final downloaded file.

### Phase 2: The Multi-Select Queue UX

- **Intake Flow Modification:** In the Search/Episode selection phase, separate the "Play" and "Download" intents.
- **Bulk Selection:** If the user selects "Download" at the series/season level, present an Ink-based multi-select checklist (e.g., `[ ] Episode 1`, `[x] Episode 2`).
- **Batch Enqueue:** Upon confirmation, silently resolve the streams (using the global quality preset) and push all selected episodes to the SQLite queue in the background.

### Phase 3: The Download Manager Shell

- **Sticky Footer:** Add a persistent status indicator to the main CLI menu (`[↓] 2 Active (45%) • 3 Queued • Press 'D' for Manager`).
- **Manager View:** Create a dedicated Ink dashboard (`DownloadManagerShell.tsx`) to monitor and manage the SQLite queue.
  - Display active downloads with live progress bars.
  - Display queued and failed jobs.
  - Implement controls to **Pause**, **Resume**, and **Cancel** jobs interactively.

## 3. Pre-flight Checks (Disk Space)

- Before appending to the queue, implement a `statfs` check (native to `node:fs/promises`) to ensure there is adequate disk space (e.g., min 2GB available) for the target directory, preventing runtime crashes.
