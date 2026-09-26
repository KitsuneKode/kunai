---
"@kunai/providers": patch
---

fix(providers): hianime errors name the failed request; surface embed artwork

Curl and HTTP failures now include `from https://host/path` — the upstream
#1902 behavior — with the query stripped so a `/search?keyword=…` title never
lands in logs. Cloudflare-block advice is gated on the binary that actually
ran: an impersonating wrapper says "curl-impersonate was already used" instead
of telling the user to install what just ran. The embed's `poster` and
`sprite_vtt` fields were parsed and dropped; they now ride the standard
`artwork` slot (`posterUrl`/`seekBarVttUrl`) on streams and variants, which the
source-inventory projection turns into real seek-thumbnail/artwork capability
flags.
