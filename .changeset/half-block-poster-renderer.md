---
"@kitsunekode/kunai": minor
---

Show posters on every terminal, including Windows.

- New half-block renderer decodes JPEG/PNG in process and paints two pixels per
  cell with truecolour SGR, so posters no longer require `chafa` — which is
  effectively never installed on Windows, where posters previously never
  appeared at all.
- Windows Terminal no longer auto-selects sixel: support only landed in 1.22 and
  the environment reports no version, so an older build rendered raw escape
  bytes. `KUNAI_IMAGE_PROTOCOL=sixel` still forces it.
- Poster cache moved onto the shared OS cache root (`getKunaiPaths`) instead of a
  hand-rolled `$HOME/.cache`, which is not a location Windows has.
- `KUNAI_IMAGE_PROTOCOL=half-block` forces the new renderer anywhere.
