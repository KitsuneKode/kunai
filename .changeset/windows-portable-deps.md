---
"@kitsunekode/kunai": patch
---

Install yt-dlp and curl-impersonate on Windows one-click installs.

`irm … | iex` left YouTube and anime search broken: `winget install yt-dlp`
matches both the real package and a Microsoft Store listing, so it refuses to
run, and curl-impersonate has no Windows package at all. The native installer
now drops verified GitHub binaries into `%LOCALAPPDATA%\kunai\deps\` and puts
those folders on the User PATH. `mpv` is still a package-manager prompt.
`--skip-deps` skips the helpers. Doctor's copy-paste fallback is
`winget install --id yt-dlp.yt-dlp -e`.
