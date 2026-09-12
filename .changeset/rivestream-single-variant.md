---
"@kitsunekode/kunai": patch
---

Start Rivestream playback faster, and show its real quality options.

Rivestream hands out a playlist that lists several qualities. Given that, the
player opens and inspects every quality before it plays any of them — through a
slow proxy, roughly seven extra requests before the first frame. Kunai now picks
one quality itself and gives the player just that, so it starts on the first
request it needs. The quality picker in `/tracks` also lists the actual
resolutions instead of a single "HLS" entry.

Streams whose audio lives in a separate track are left as they were, since
splitting those would play without sound.
