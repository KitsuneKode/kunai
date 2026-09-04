---
"@kitsunekode/kunai": patch
---

Stop the HLS relay from failing on Windows when curl has no HTTP/2.

The relay spawns the literal `curl` from PATH and always passed `--http2`.
Windows' System32 build is Schannel with no nghttp2, and it rejects that flag
outright (`the installed libcurl version doesn't support this`, exit 4) rather
than negotiating down — so every stream routed through the relay failed on a
stock Windows host. The relay now probes the binary's feature list and drops
the flag instead of the request.

The installer also stopped hiding the `cURL.cURL` upgrade prompt when
curl-impersonate is installed. They are different binaries solving different
problems: curl-impersonate clears Cloudflare for the provider clients, and
carries no `curl.exe` of its own.
