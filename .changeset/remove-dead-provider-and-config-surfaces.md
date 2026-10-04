---
"@kitsunekode/kunai": patch
---

Remove dead provider/config surfaces: drop the unused `Provider.resolveStream`/`capabilities` projection, the `MediaTrackService`/`provider-work-lane-policy`/`download-scope-policy` wrappers, the `provider-relay-settings` re-export shim, test-only `checkStreamHealth`, `ProviderResolveInput.regionHint`, and zombie config keys (`headless`, `autoDownload`, `autoDownloadNextCount`, `subLang`, `animeLang`, `powerSaverAllowManualArtwork`, `artworkPreviewsEnabled`) that were persisted and normalized but never read. Narrow `ProviderResolveInput.intent` to the values actually produced (`"play" | "refresh"`). The tracks panel now surfaces an empty provider section's reason instead of dropping it silently, docs pages only badge `beta`/`planned` (not `shipped`), and the `· current` picker suffix is consolidated into one helper.
