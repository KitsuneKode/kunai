---
status: active
created: "2026-11-25"
lastReviewed: "2026-11-26"
---

# Anitaku (gogoanime successor) provider lane

Spec only; nothing is implemented. Written from a 2026-11-25 ecosystem check.

## Evidence and implementation notes

Ecosystem evidence 2026-11-25: gogoanime canonical domains parked/for-sale
(gogoanime.mom, anitaku.pe), anitaku.bz/.to connection-dead even through DoH.
**`anitaku.io` is alive**: 301 → /browse/ → 200, 115KB real catalog HTML.
The backend is the same gogoanime database under the anitaku rebrand.

Implementation notes for the provider build:

- Search: anitaku.io/search.html?keyword= returns list HTML (verify shape —
  first extraction attempt returned empty, needs a real RE pass with the
  page's actual markup)
- Embed chain: gogocdn/vidstreaming-style with AES-encrypted embed params —
  the hardest extraction genre in the scene; keys rotate
- Legal exposure: aniyomi removed this source after DMCA — expect the hottest
  domain-rotation treadmill in the roster. Hotfix-manifest domain override
  support is mandatory, not optional.
- Value despite cost: largest independent anime catalog + real dub coverage,
  and the backend half the FMHY frontends wrap — implementing it directly
  removes the middleman layer those skins add.

Prerequisite decision: confirm whether search extraction is plain HTML or
JS-rendered before scoping. If JS-rendered, the cost likely exceeds the value
vs. fixing allmanga crypto (which restores a multi-host aggregator covering
much of the same catalog).
