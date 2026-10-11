---
"@kitsunekode/kunai": patch
---

Fix terminal text measurement for non-ASCII titles and wrap long error text.

Truncation counted UTF-16 code units as terminal columns, so a title in CJK
came out nearly twice the intended width and a clip could split an emoji
surrogate pair. Word-boundary truncation now walks columns — wide characters
count as two, combining marks as zero — and falls back to a column-aware hard
cut when no boundary fits.

The playback-failure panel now wraps the free-text failure message and debug
excerpt to the panel's text width instead of clipping them mid-word at the
edge, so the sentence that says what failed is the one you can read.
