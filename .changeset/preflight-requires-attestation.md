---
"@kitsunekode/kunai": patch
---

Playback preflight no longer trusts resolve age alone.

The `playback-preflight` health plan used to waive its probe for any stream
younger than `playbackTrustMs` (5m), verified or not. Providers without a
resolve-gate hand playback URLs that no code has ever fetched, and
episode-to-episode autoplay replacements trusted the same plan — a dead or
expired URL could go straight to mpv within the window. The waiver now applies
only to `streamReachabilityVerified` streams inside the trust window; every
other stream probes at handoff. The probe already races mpv's `loadfile`, so a
healthy stream adds no wait, and a definitive failure only aborts when mpv
itself also failed — the fix converts a silent black window into a named
stream-unreachable error.
