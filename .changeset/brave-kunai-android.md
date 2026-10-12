---
"@kitsunekode/kunai": minor
---

Add an experimental Android Termux distribution with ARM64 and x64 Bionic binaries, explicit `--player auto|mpv|vlc` selection, and safe direct-stream handoff to VLC or mpv-android.

Detached playback now rejects streams that require managed headers, cookies, subtitles, local files, or deferred extraction, and it does not infer progress, completion, autoplay, provider health, or queue acknowledgement after Android accepts an intent.
