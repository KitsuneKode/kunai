---
"@kitsunekode/kunai": patch
---

Preserve exact provider-native anime episode identities from catalog selection through playback, caching, downloads, and offline recovery.

### Fixes

- Keep Kunai's episode picker 1-based while resolving AllAnime episode zero, OVA, and special labels with their exact provider values.
- Prevent cache, selection, prefetch, dead-stream, download, and offline-library state from aliasing different provider episodes at the same UI position.
- Preserve existing numeric fallback behavior for legacy downloads and selections that predate provider-native episode identity storage.
