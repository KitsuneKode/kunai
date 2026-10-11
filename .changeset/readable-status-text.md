---
"@kitsunekode/kunai": patch
---

Make error and series-complete text readable, and keep every text tier readable on a selected row.

Error messages were drawn in a red, and series-complete labels in an indigo, that were
much darker than the accent, warning and info colors beside them and hard to read on a
dark terminal. Both now use a lighter shade of the same hue. The red on the error
banner's border and in the falling petals is unchanged.

The three secondary text tiers are also a touch brighter, so hints and labels reach
their readability targets on a selected row, not only on the plain background.
