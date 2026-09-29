---
"@kunai/cli": patch
---

fix(player): find mpv through Flatpak when PATH has no mpv

Six call sites did a bare `Bun.which("mpv")` and reported "not installed" on
Steam Deck / Flatpak-only hosts where `flatpak run io.mpv.Mpv` plays fine. New
`mpv-discovery.ts` walks an ordered ladder — PATH binary, then the
`io.mpv.Mpv` flatpak app dirs at system (`/var/lib/flatpak`) and user
(`~/.local/share/flatpak`) scope — and returns a full spawn argv, so launch,
persistent sessions, trailer playback, capability probes, and the support
bundle's version probe all agree on the same discovery.
