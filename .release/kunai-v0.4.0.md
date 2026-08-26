# Kunai 0.4.0

[`9d94664`](https://github.com/KitsuneKode/kunai/commit/9d946648ca253965fa88c485be448e81c2a1f470) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Make shared playback targets easy to open outside an existing Kunai install.

### Features

- Copy browser-safe, catalog-anchored HTTPS links from `/share` and mpv.
- Add a stateless web handoff with native install guidance and no share-page analytics.
- Accept compact checksummed share codes and render scannable HTTPS QR codes with `/share --qr`.

[`d5f25ae`](https://github.com/KitsuneKode/kunai/commit/d5f25ae6dca966237d886ba5c006fd92dfe6a175) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Persist expensive provider intermediate data across restarts.

### Features

- Add a general `ProviderCachePort` (namespace + TTL) to the provider runtime
  context, backed by a SQLite `provider_cache` table, so a provider's expensive
  but stable intermediate data survives a restart instead of dying with the
  process.
- Miruro's episode catalog now reads memory → persistent → network, so the cold
  Cloudflare-gated pipe call (~6–13s) is paid once per catalog per TTL rather
  than once per session.

### Behavior

- The persist TTL is derived from the catalog's own air dates: a finished show
  persists for 12h, while an airing show persists until its approximate next air
  date (clamped to 2h–1 week), so a newly-aired episode is never hidden behind a
  stale cache.
- Only a non-empty catalog is persisted; a failed or empty body is never cached.
  The cache degrades to a no-op on any store error — a broken cache slows a
  resolve, never fails it. Stream/source URLs stay in-memory and are never
  persisted.

[`a53b62d`](https://github.com/KitsuneKode/kunai/commit/a53b62d8de7db4166a54d0b60a58938b4918c52f) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Warm the top anime result's episode cache during search.

### Features

- After an anime search, Kunai warms the persistent episode cache for the single
  top anime result in the background, so the Cloudflare-gated catalog fetch
  (~6s) is already paid by the time you pick it. It is fire-and-forget — it never
  blocks, delays, or fails the search — deduped so a title is warmed once per
  session, and limited to one gated call per search to stay gentle on the WAF.

[`db71c33`](https://github.com/KitsuneKode/kunai/commit/db71c332a13eba5081dd877951e784b6bd44b3ed) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Preserve exact provider-native anime episode identities from catalog selection through playback, caching, downloads, and offline recovery.

### Fixes

- Keep Kunai's episode picker 1-based while resolving AllAnime episode zero, OVA, and special labels with their exact provider values.
- Prevent cache, selection, prefetch, dead-stream, download, and offline-library state from aliasing different provider episodes at the same UI position.
- Preserve existing numeric fallback behavior for legacy downloads and selections that predate provider-native episode identity storage.

[`443111a`](https://github.com/KitsuneKode/kunai/commit/443111a7fccb49b58449c9feb953f520bdcd7694) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Reject untrusted or downgraded HLS relay redirects before requesting them, and bound yt-dlp streaming output.

[`1ee8d09`](https://github.com/KitsuneKode/kunai/commit/1ee8d09e3e3dee98d06f89334f816587352102e1) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Rebuild first-run setup as seven framed slides that write what they ask for: every control starts from your current configuration, so rerunning `/setup` no longer disconnects linked AniList or TMDB accounts or rewinds preferences to factory defaults; the language choice reaches anime, shows, films, and YouTube alike; `[s]` applies the slide's recommendation instead of committing whatever the cursor sat on; leaving asks before discarding answers and re-offers setup next launch if you left on the first slide; and tracker sync is only marked enabled once the browser handoff actually succeeds. The usage-ping slide stays recommended and pre-selected, and remains impossible to enable by skipping, accepting all defaults, or stepping onto the slide and back off it.

[`1523ec7`](https://github.com/KitsuneKode/kunai/commit/1523ec7b77dff4657abee917f962f625b17b3c62) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Bound GitHub and npm update-metadata requests to 15 seconds, use the injected
request path for every install channel, and reject malformed registry versions.

[`91cca8a`](https://github.com/KitsuneKode/kunai/commit/91cca8adface511dc5b5033fabd3e1b9aa78af6e) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Serialize native installer activation across the in-process updater and the Bash and PowerShell installers, preserving launcher and manifest consistency during concurrent upgrades and recovery failures.

[`a20020b`](https://github.com/KitsuneKode/kunai/commit/a20020b1f8469b21aa55798623b31dbf55baad85) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Download verified platform archives for native self-updates, safely extract one bounded executable in-process, and preserve rollback-compatible provenance while migrating schema-1 install manifests.

[`3b9207d`](https://github.com/KitsuneKode/kunai/commit/3b9207d7ad16f26ba9114d7eb28bf453eb1c5521) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Install verified compressed native release assets from Bash and PowerShell, reject unsafe or oversized archive contents, and retain a 404/410-only fallback for older raw releases.

[`501f83f`](https://github.com/KitsuneKode/kunai/commit/501f83f28852c0f62c4341554baaa742271a222d) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Redact standalone opaque credential values from diagnostics even when an upstream field uses an unrecognized name.

[`5dbd508`](https://github.com/KitsuneKode/kunai/commit/5dbd50898f1cfb83321cf16827eb35f492754ba4) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Keep unexpected background download-queue failures inside the download
subsystem so they cannot terminate playback.
