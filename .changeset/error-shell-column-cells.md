---
"@kitsunekode/kunai": patch
---

The playback failure panel's cell buffer now counts terminal columns, not
code points (#465).

`ErrorShell` laid row text into a one-cell-per-code-point buffer and clipped
at `width` cells, so an unwrapped CJK row (waterfall entries are never
wrapped) rendered nearly twice its allotted width — and `rowEndColumns`
mismeasured where text ended, letting sakura petals land inside text lanes.
Each cell is now a real column: a wide glyph claims its second column as an
empty cell, combining marks fuse onto the glyph they modify, and the petal
lanes and width clip measure actual screen space.
