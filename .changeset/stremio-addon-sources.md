---
"@kitsunekode/kunai": minor
---

Add your own Stremio addons as movie and series sources.

### Features

- `kunai addons add <manifest-url>`, `list`, `remove` and `check`, plus
  **Settings → Sources → Stremio addons**. Kunai ships no addon; each one you
  add becomes a provider you can reorder and switch off like any other.
- Only direct video links are played, and each is checked before it reaches
  mpv. Torrent-only results are skipped and reported.
- An addon's URL is treated as a secret: only its host is ever shown or logged.
