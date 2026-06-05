# Kunai — Raster Image Prompts

Copy-paste prompts for an image agent (nano-banana / codex / cursor / Midjourney-style).
Vector assets (mark, mascot, palette) already exist in this folder — these cover the
raster pieces those tools can't author: the hero render, the social/OG card, and the
animated README banner. Keep the palette **exact**.

**Locked palette:** background `#100b0f` · fur/brand rose `#ff8fb0` · deep rose `#d85f86`
· cream `#ffc6d8` · eyes/ink `#140d11` · accents: violet `#c98bff`, teal `#4fd1c5`,
gold `#f4c45c`, blue `#5fb6ff`. Reference shape: the fox in `kunai-mascot.svg` and the
mark in `kunai-mark.svg`.

---

## 1. Hero mascot render (README top / docs hero) — PNG, transparent, 1024²

> A friendly pixel-art kitsune (fox) bust, front-facing, two simple square pixel eyes,
> cream cheeks and muzzle, small dark-rose nose, two pointed ears with cream inner highlights.
> Body fur in warm rose `#ff8fb0` with deep-rose `#d85f86` outline; cream `#ffc6d8` accents.
> Clean 16-bit pixel-art, crisp hard edges, no anti-aliasing, no gradient, no outline glow.
> Transparent background. Centered, generous padding. Cute but sharp — confident, not babyish.
> Matches the pixel grid of `kunai-mascot.svg`. Single character, no text.

## 2. Social / OG card — PNG, 1200×630

> A premium dark social card on background `#100b0f`. Left: the pixel-art rose kitsune
> mascot (as in prompt 1) at ~320px. Right: large wordmark "KUNAI" in a clean geometric
> monospace, color `#f6eff4`, wide letter-spacing, with a one-line tagline beneath in muted
> mauve `#968a98`: "Terminal-first streaming. Finds the playable stream." Bottom-right, small
> dim mono caption `kitsunelabs.xyz`. Three tiny dots in violet `#c98bff`, teal `#4fd1c5`,
> gold `#f4c45c` as a content-kind motif. Lots of negative space, no clutter, no stock
> imagery, subtle film grain. Feels like a senior identity studio made it.

## 3. Animated README banner — GIF or APNG, ~480×200, loops

> A dark terminal banner, background `#100b0f`. The rose pixel kitsune mascot sits at left.
> Idle loop: slow gentle vertical bob (~2px), a blink every ~4s (eyes briefly close), one
> ear twitch every ~6s. To the right, monospace text types once then holds:
> line 1 `🦊 Kunai v0.2` in `#f6eff4`, line 2 `~/watch · anime · series · movies` in muted
> `#968a98`, line 3 a rose-accent `#ff8fb0` line `▸ finds the playable stream`. Crisp pixel
> rendering, no motion blur, seamless loop, ≤2s. (Use this GIF in the README since GitHub
> strips SVG animation.)

## 4. Favicon / app icon — PNG set 512 / 192 / 32

> The `kunai-mark.svg` fox-blade mark, rose `#ff8fb0` on a rounded-square tile of `#1c1620`
> with a 1px `#473b51` inner border. Centered, ~70% optical fill. Export 512, 192, 32, and a
> 16px solid-silhouette variant (drop the eyes/sparks at 16px for legibility).

---

**After generation:** drop PNG/GIF into `.design/brand/` (or `docs/assets/`) and reference
them from the README. Tell me the filenames and I'll wire them into the README layout.
