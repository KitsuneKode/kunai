---
"@kitsunekode/kunai": patch
---

`NETWORK_ERROR_PATTERNS` no longer matches the bare substring `"dns"`.

Any provider error containing those three letters — a URL on a `dns.*` host,
a title name echoed into an error — classified as `offline`, and two such
false positives across distinct providers tripped the engine's consecutive-
offline threshold and halted every live candidate. The list now matches the
phrasings transports actually produce (`could not resolve`,
`name or service not known`, `temporary failure in name resolution`,
`getaddrinfo`, …).
