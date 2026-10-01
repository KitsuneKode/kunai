---
"@kitsunekode/kunai": patch
---

Shell UX honesty fixes for the details card, `doctor`, and season loading.

**The browse details card no longer overlaps or duplicates rows.** Three bugs
compounded in the companion sheet. The header sliced a fixed count of rows out
of the body list based on its own rendered header rather than the list it
received, which silently dropped the first real section header and rendered
the synopsis twice. Rows were priced against the outer card width instead of
the content width inside the border and padding, so Yoga shrank the label cell
and label merged into value (`WatchlistNot saved`). And the card rendered its
full natural height inside a height-bounded flex row, so on shorter terminals
Yoga compressed children to zero height and rows painted on top of each other.
The sheet now treats `lines` as body rows only, budgets every row against the
true inner width, keeps a visible separator between label and value, and
accepts a `maxHeight` from the shell so it clamps itself with a `▼ scroll`
affordance instead of overflowing.

**`doctor` no longer reports a missing-but-creatable directory as broken.** The
storage writability probe now walks up to the nearest existing ancestor and
tests that. A path that does not exist yet but can be created is reported as
writable, while a file occupying the path is reported as blocking it rather
than blamed on permissions. Elevated-permission remediation is now reserved
for genuinely unwritable directories.

**Season and calendar loading now say what actually failed.** Loading season
data used to collapse every failure into "check your connection", including
cases where the network was fine. Failure kinds are now propagated from the
TMDB layer, so the CLI can distinguish being offline, a series with no season
data, an upstream provider error, and a malformed response, and say so. A
failed episode lookup after seasons loaded is reported as a lookup failure
rather than silently looking like a cancel, and a calendar where every source
failed only claims a connection problem when every failure really was a
transport error.
