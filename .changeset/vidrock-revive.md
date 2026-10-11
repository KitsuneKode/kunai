---
"@kitsunekode/kunai": minor
---

Vidrock is back in the production provider set on its rotated API scheme.

The upstream API moved from AES-CBC item ids to a per-lane map of
`base64url(iv ‖ AES-256-GCM ciphertext)` server entries. The adapter ports the
new wire format, verifies the GCM tag (a tampered or stale blob rejects), and
treats "every lane carried ciphertext but none decrypted" as a diagnosable
scheme rotation instead of an honest catalog miss.

Two upstream quirks are now honored end to end: stream requests carry the
single-space `User-Agent` the ngcorp segment hosts require, and TLS-gated lanes
(workers.dev, challenged Orion hosts) are filtered by the resolve-gate probe.
The whitespace UA required a matching fix in the mpv header normalizer, which
used to trim `" "` away — the provider declared the header and playback
silently dropped it.
