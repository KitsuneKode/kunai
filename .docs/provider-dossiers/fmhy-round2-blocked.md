---
status: current
lastReviewed: "2026-10-13T02:00:00Z"
---

# FMHY Round 2 — VidBox / SmashyStream / HydraHD / NEPU (all blocked)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

> Agent-facing (L3). Research round from FMHY `/video`, 2026-10-13. Verdict:
> do not implement any of the four — all are unreachable or gated from review
> networks. Re-probe before any intake.

## VidBox / VidPlus — player infra down, frontend Turnstile-gated

- **Docs (public):** `github.com/vidbox1/vidplus` — embed contract is clean
  TMDB-in: `player.vidplus.to/embed/movie/{tmdbId}`,
  `/embed/tv/{tmdbId}/{s}/{e}`, `/embed/anime/{anilistId}/{ep}?dub=` plus a
  `server=` selector. Ideal shape on paper.
- **Reality 2026-10-13:**
  - `vidbox.vc` 308 → `vidbox.wtf` (domain hop).
  - `player.vidplus.to` 301 → `player.vidplus.pro` → `player2.vidplus.pro`
    **522** (origin down).
  - `vidbox.wtf` serves (200, Next.js) but loads
    `challenges.cloudflare.com/turnstile/v0/api.js` — Turnstile-gated,
    hostile to the browserless intake path.
- **Decision:** park until the player infra answers without Turnstile. If it
  recovers, the embed page (not the docs) is the research target — find the
  JSON stream API behind the iframe.

## SmashyStream — down

- `smashystream.xyz/` and `/embed/movie/550`: connection fail (000) from two
  reviews. No backend to intake. Re-check DNS before any revisit.

## HydraHD / NEPU — WAF-gated front doors

- `hydrahd.ws/` and `/watch/movie/550`: HTTP 403 (~5.4KB challenge bodies).
- `nepu.io/`: HTTP 403 (~5.3KB challenge body).
- No public API docs found for either; both need a probe from an ungated
  network or a user-owned relay before dossier-level research is possible.

## What this means for the lane strategy

No FMHY candidate is currently intakeable: one has dead player infra behind a
Turnstile frontend, one is down, two are WAF-gated. Provider depth (healthy
lanes' parity, toggles, torrent-direct, YouTube, downloads) outranks provider
breadth until a re-probe flips one of these rows. Re-probe monthly or when a
lane is lost.
