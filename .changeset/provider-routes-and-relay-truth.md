---
"@kitsunekode/kunai": minor
---

Keep the anime auto-skip and provider-relay paths working after upstream rotations.

- AniSkip now resolves a MAL id for AniDB titles, so opening and ending skips work on the default anime provider instead of silently never firing. The lookup shares the provider package's Cloudflare-aware transport and overlaps stream resolution, so it adds no serial request to playback start.
- AllAnime tracks the upstream `mkissa` rotation to build 119 and 7-day epochs; the previous constants failed every stream request with `AA_CRYPTO_MISSING_BUILD`.
- A relay no longer strips the provider-auth headers (`x-build-id`, `x-aa-boot`, `x-obfuscated`, `x-session-token`) that AllAnime bootstrap and Miruro decoding depend on, which previously made every bootstrap through a relay fail with `invalid_boot_token`.
- A Miruro request blocked by Cloudflare now names the user-owned relay workaround rather than reporting an unexplained failure.
