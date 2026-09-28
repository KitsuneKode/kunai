---
"@kitsunekode/kunai": patch
---

Point the published `homepage` at the docs site rather than the README anchor.

npm renders `homepage` as the "Homepage" link on the package page, and it is the
first thing someone evaluating the CLI clicks. `github.com/KitsuneKode/kunai#readme`
sends them to a raw README anchor; `kunai.kitsunekode.in` is the site that actually
documents installing and using Kunai. The field propagates from the CLI manifest into
all eight platform packages, so every published package now points at the same place.
