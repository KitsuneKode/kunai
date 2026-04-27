# Storage Architecture & Hardening Plan

This document breaks down the state of our flat-file JSON storage, identifies critical loopholes, and tracks our implementation decisions to harden the system.

## 1. Scale & Bloat: The Math (4 episodes/day)

If a user watches 4 episodes a day for a month, they generate **120 history entries**.
If they keep that pace for an entire year, they generate **~1,460 entries**.

A typical history entry is roughly 150-200 bytes of JSON.

- **1 Month (120 entries)** = ~24 Kilobytes
- **1 Year (1,460 entries)** = ~292 Kilobytes

For a modern CPU, parsing a 300KB JSON file takes less than **1 millisecond**.
**Conclusion on Scale:** Flat JSON will _not_ bottleneck or bloat in any meaningful way for user history.

## 2. The Real Loopholes: Corruption & Race Conditions

> **Loophole 1: Mid-Write Crashes (The Corruption Risk)**
> We currently use `await writeFile(...)`. If the user hits `Ctrl+C` or the terminal crashes in the exact millisecond the file is being written, the OS writes an incomplete file. The next time they boot the app, `JSON.parse` will fail, and their **entire watch history is permanently destroyed**.

> **Loophole 2: Concurrency Race Conditions**
> We read the whole file, modify a key, and write the whole file back. If two async processes (e.g. background cache refresh and a history update) fire at the exact same time, the slower write will overwrite the faster write, causing silent data loss.

## 3. Implementation Decisions

### Decision 1: Architecture Path

**Decision:** Harden the JSON approach (Atomic writes & Write-locking) rather than migrating to SQLite.
**Why:** Keeps the project footprint small, requires no dependencies, and is incredibly fast for our scale.

### Decision 2: Storage Locations (Cross-Platform)

We will implement an OS-aware path resolver so files land exactly where they belong natively.

**Linux (XDG Base Directory Spec):**

- **Config:** `~/.config/kitsunesnipe/config.json`
- **History:** `~/.local/share/kitsunesnipe/history.json`
- **Cache:** `~/.cache/kitsunesnipe/stream_cache.json`

**macOS:**

- **Config:** `~/Library/Application Support/kitsunesnipe/config.json`
- **History:** `~/Library/Application Support/kitsunesnipe/history.json`
- **Cache:** `~/Library/Caches/kitsunesnipe/stream_cache.json`

**Windows:**

- **Config:** `%APPDATA%\kitsunesnipe\config.json` (Roaming)
- **History:** `%LOCALAPPDATA%\kitsunesnipe\history.json` (Local)
- **Cache:** `%LOCALAPPDATA%\kitsunesnipe\stream_cache.json` (Local)

### Phase A: Atomic Writes & Safeguards (Backend)

1. **Atomic Saves**: Modify `FileStorage.ts` to write to `history.json.tmp` first, then use `fs.renameSync` to swap it with `history.json`. Renames are guaranteed atomic by the OS. It is impossible to corrupt the file during a crash this way.
2. **Safe Parsing**: If `JSON.parse` fails, we should rename the broken file to `history.json.corrupt.bak` instead of just silently erasing the user's data.
3. **Queueing**: Add a simple in-memory write-lock queue to `FileStorage` so overlapping saves are processed sequentially, fixing race conditions.

### Phase B: Cache & History Management (UI)

1. **Cache UI**: Add a `[C] Clear Cache` hotkey in the Settings menu that triggers `await container.cacheStore.clear()`.
2. **History Pruning**: Add a `[P] Prune History (Older than 6 months)` command in the UI.
