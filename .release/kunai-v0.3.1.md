# Kunai 0.3.1

Point the published `homepage` at the docs site rather than the README anchor.

npm renders `homepage` as the "Homepage" link on the package page, and it is the
first thing someone evaluating the CLI clicks. `github.com/KitsuneKode/kunai#readme`
sends them to a raw README anchor; `kunai.kitsunekode.in` is the site that actually
documents installing and using Kunai. The field propagates from the CLI manifest into
all eight platform packages, so every published package now points at the same place.

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

Install yt-dlp and curl-impersonate on Windows one-click installs.

`irm … | iex` left YouTube and anime search broken: `winget install yt-dlp`
matches both the real package and a Microsoft Store listing, so it refuses to
run, and curl-impersonate has no Windows package at all. The native installer
now drops verified GitHub binaries into `%LOCALAPPDATA%\kunai\deps\` and puts
those folders on the User PATH. `mpv` is still a package-manager prompt.
`-SkipDeps` skips the helpers. Doctor's copy-paste fallback is
`winget install --id yt-dlp.yt-dlp -e`.

Managed helper digests are retained and rechecked on later installs, so an
interrupted or modified helper is repaired instead of accepted by filename.
