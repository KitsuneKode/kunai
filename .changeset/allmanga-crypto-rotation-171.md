---
"@kitsunekode/kunai": patch
---

Restore AllAnime playback after mkissa's crypto rotation.

The pinned mkissa `buildId` (140) has been dropped upstream, so every bootstrap
returned `unknown_build_id`, the provider silently fell back to bundled crypto
material, and AllAnime resolved nothing.

Pinning the new build id alone does not fix it. A rotation moves every
derivation constant together: 140 → 171 also changed `saltMul`, `saltAdd`,
`fragMul`, `fragAdd`, the boot prefix, the boot-token separator (`.` → `/`),
the order of the boot-token parts, and all four mask fragments. A token built
from build 171 with the build-140 constants is rejected `invalid_boot_token`.

Everything that rotates now lives in one `ALLMANGA_CRYPTO_PROFILE` object, so a
rotation is a single replacement that cannot be applied halfway, and the
bundled fallback key is pinned to derive under that same profile — a key left
over from an older build is not a degraded fallback, it is a guaranteed
decrypt failure.

The two rotation failures are also distinguishable now instead of surfacing as
the same unexplained crypto miss: `unknown_build_id` reports `build-rotated`
and `invalid_boot_token` reports `token-rejected`, both emitted on the provider
trace. A new opt-in check catches the next rotation before users do:

```sh
KUNAI_LIVE_ALLMANGA_ROTATION=1 bun run test:live:allmanga-rotation
```
