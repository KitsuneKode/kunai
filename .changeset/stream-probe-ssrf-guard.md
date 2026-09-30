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
intranet names. On the real network path the guard goes further: the name is
resolved, every answer is checked against the blocklist, and the connection is
pinned to a validated address — `Host` and TLS `serverName` keep the original
authority while the request literally targets the checked IP — so a name that
answers publicly for the check cannot privately re-resolve for the fetch
(DNS rebinding). Lookups race the probe deadline and fail closed on an error
or an empty answer. `proxy: false` keeps a configured proxy from re-resolving
the name and undoing the check. Fetch ports that open local sockets declare
`resolvesLocally` so the guard can pin through their wrapped fetch; ports that
resolve elsewhere keep hostname URLs untouched.

Redirects are followed by hand and each hop is resolved and pinned again
(bounded at 3); credentials headers no longer cross origins on a redirect. A
blocked target reports as a definitive unreachable probe, so the resolve gate
rejects the candidate and the player never sees the URL.
