---
"@kitsunekode/kunai": patch
---

The command palette now matches queries against a command's canonical id, not
just its aliases — `image-pane` answers "Image Pane" as expected instead of
vanishing because the hyphenated id was never a match target.
