---
"@kitsunekode/kunai": patch
---

Stop provider-supplied URLs from steering Kunai's own fetches at private
network targets.

Every URL a provider hands back — a stream candidate, an HLS master playlist,
a subtitle file — is untrusted markup. Until now the stream probe, the HLS
rendition ladder, the playback-time manifest prefetch, and the subtitle
downloader all fetched those URLs (and whatever playlists derived from them)
without checking where they pointed. A hostile or compromised page could name
`http://169.254.169.254`, a LAN address, or `localhost` and Kunai would issue
the request itself.

All of those fetches now run through a shared target guard: http(s) only, no
loopback / link-local / private / CGNAT / multicast literals for IPv4 or IPv6
(including IPv4-mapped and NAT64 forms), no `localhost`-family or single-label
intranet names, and — when the real fetch is used — DNS answers are checked so
a public-looking name cannot resolve to a private address. Redirects are
followed by hand and re-validated at every hop (bounded at 3), and credentials
headers no longer cross origins on a redirect. A blocked target reports as a
definitive unreachable probe, so the resolve gate rejects the candidate and
the player never sees the URL.
