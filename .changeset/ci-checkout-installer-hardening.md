---
"@kitsunekode/kunai": patch
---

Fix Windows installer optional deps so yt-dlp is still offered after mpv, and improve binary-download errors when a GitHub Release has no assets.

CI: require `actions/checkout` before the local `setup-bun-monorepo` composite (nested checkout never ran), assert release uploads are non-empty, and smoke host-native binaries on Linux/macOS/Windows after the weekly 8-target build.
