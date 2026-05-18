# Provider Contract Recommendations

Based on the intelligence gathered across VidKing, Cineby, AllManga, Miruro, and Rivestream, this document defines how the research should become implementation fuel. The core objective is zero-regression, 0-RAM streaming with robust caching.

## Implementation Order

1. **Normalize provider source inventory.** Implement the `ProviderSourceInventory` type across all engine boundary layers.
2. **Fix cache keys.** Ensure audio/sub/source/quality parameters are strictly factored into the Cache Key generation. If AllManga's `translationType` is omitted from the cache key, switching from Sub to Dub will load the cached Subbed stream.
3. **Build pickers from inventory.** The UI shell's source, quality, and subtitle pickers MUST be driven by the normalized `ProviderSourceInventory`, not the raw provider payloads.
4. **Unify downloads.** Make the `yt-dlp` download engine use the exact same inventory and sidecar model as the MPV playback engine.
5. **Add capability badges.** The CLI/UI should only show "Multi-Audio" or "Native Thumbnails" badges if the underlying provider engine explicitly declares support.
6. **Add deterministic tests.** Write tests directly targeting the edge cases found in the provider dossiers (e.g., testing the Cineby `killjoy` -> `de` regex mapping).
7. **Update documentation.** Update `README.md` and user-facing docs from this stable contract, not from behavioral guesses.

## The Best Rule: Data Origins & Stability

When writing engines, developers MUST document their findings based on this criteria:

- **What data exists:** Be specific (e.g., `episodeInfos.thumbnails[]`).
- **Where it comes from:** The exact endpoint or GraphQL hash (e.g., Hash `c8f3ac51...`).
- **How stable it is:** Is it highly volatile (Miruro XOR keys) or highly stable (TMDB passthrough)?
- **Whether it should affect cache identity:** If it changes the video bytes or language, it MUST be in the cache key.
- **Whether it is user-visible:** Does the UI need a Deferred Locator to display this data?
- **Whether it is needed for playback, download, diagnostics, or only polish:** Differentiate between critical path (stream URL) and polish (seek-bar thumbnails).

## Architectural Mandates

1. **Deferred Locators over N+1 Queries:** Do not block UI mounting waiting for a 2nd API call to fetch a thumbnail. If the data is missing, render the UI immediately and populate it async via Deferred Locators.
2. **Strict ISO Enforcement:** The core system ONLY speaks ISO 639-1. Engines map `ja` to `sub`, `Hindi` to `hi`, `fade` to `en`.
3. **State Handover (Resume Point):** Switching servers/languages that result in a new `.m3u8` manifest requires the shell to capture the current playback time and restart MPV with `--start={time}`.
