---
"@kitsunekode/kunai": patch
---

Make secondary text readable, and honour reduced motion in the loading spinner.

Hints, placeholders, pending steps and metadata labels were drawn in colors that
passed the usual contrast ratio but were barely legible on a dark terminal. The
dimmest tier was barely above the level at which text is discernible at all on a
selected row. The three secondary text tiers are brighter now (same hue, lightness only),
the 256-colour fallbacks match, and a test keeps them there. Where a hint also
set the terminal's own "faint" attribute on top of its color, which dimmed it a
second time, that is removed.

`KUNAI_REDUCED_MOTION=0` no longer turns reduced motion on, and the loading
spinner now stops animating when `KUNAI_REDUCED_MOTION` or `NO_MOTION` is set.
Both variables are documented under Customization.
