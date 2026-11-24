---
"@kitsunekode/kunai": patch
---

Stremio addons are experimental and off by default. Review and accept the
playback risk in **Settings > Sources > Experimental: Stremio addons** or with
`kunai addons enable` (`--accept-risk` when running non-interactively). Then
add your own movie and series sources with `kunai addons add <manifest-url>`
(or `--stdin` to keep it out of argv). `kunai addons disable` stops addon use
at the next resolve — including in a running session — and keeps the
installed list and your acknowledgement. Only direct video files are
supported; downloads and Android handoff do not use addons. Full addon URLs
are never shown or logged.
