---
"@kitsunekode/kunai": patch
---

Illustrated fox companion on docs and image-capable terminals.

### Highlights

- Docs, banners, and OG cards use the illustrated kitsune (idle / watch / go / wait). The blade mark stays on favicons and badges. CLI chrome stays `🦊 Kunai`.
- Kitty, Ghostty, iTerm2, and WezTerm can show the fox as a small companion on setup and goodbye. Other terminals keep 🦊, and redirected output gets neither.
- `KUNAI_PET=off` retires the companion everywhere; `KUNAI_PET=glyph` keeps her as 🦊 even where the picture would render.
- Empty and error surfaces carry one short companion line. That is text, so it reaches every terminal rather than the four that can host a graphics protocol.
- Quitting is no longer slower for people who never see the fox: the extra exit budget is only spent when the still will actually paint.
