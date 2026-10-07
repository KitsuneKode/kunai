---
"@kitsunekode/kunai": patch
---

Refine the Ember Dusk palette: secondary text stays readable on the selected row, and unrelated signals stop sharing a colour.

`muted` text measured 3.99:1 on the selected-row band, under the 4.5:1 body floor, so it is now slightly lighter and passes everywhere (4.57:1 on the band). The brand, the surfaces and the rose accent are unchanged.

The milestone, anime, movie and series colours moved apart on the hue wheel. The milestone periwinkle sat 20° from the anime orchid and read as one purple; it is now 46° away.

On 16-colour terminals the accent, the anime kind, the milestone and the mixed-day blend were all the same `magenta`, and the warning and movie kind were both `yellow`. Each signal now has its own colour, and a test fails if two of them collapse again.

There is a new `lineControl` token for control edges (inputs, outlined buttons, toggles) at 3:1 against the surface they sit on.
