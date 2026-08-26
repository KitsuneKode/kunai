# Analytics time series, chart surface, and per-route social cards

Status: proposed
Owner: unassigned
Target: 0.3.1

Two independent tracks that both touch `apps/docs`. Neither changes the CLI, the
analytics payload, or the consent contract.

---

## Track A — Serve the history that already exists

### What we have

`daily_rollup` is keyed by `day` and holds `active_installs`,
`lifetime_installs`, `by_version`, `by_os`, `by_arch`, `computed_at`. Retention
prunes `ping_day` (raw per-install rows) and `install_lifetime`. **It never
deletes `daily_rollup`.** The full day-by-day aggregate history is already on
disk, already suppressed, and already carries no identity.

`/metrics/daily.json` serves **one row**. `buildPublicMetrics()` takes a single
`DailyRollup`. So the page renders a still frame of a film we are already
recording.

### What we need

A `/metrics/series.json` endpoint serving the last N days (default 90), and the
chart surface below.

**No new collection. No payload change. No consent change.** The aggregate is
already public-safe; this is a serving question.

### Two traps that must be designed for, not discovered

1. **Suppression on a series is not suppression on a snapshot.**
   `SMALL_CELL_FLOOR = 5` folds a bucket into `other` below five installs.
   Applied per-day across a window, a bucket sitting near the floor blinks in
   and out — and the blink pattern is itself information about a small
   population. Apply the floor **across the whole window**: if a bucket is below
   the floor on any day in the window, it stays in `other` for every day of that
   window. Cheaper and safer than per-day.

2. **`lifetimeInstalls` is not monotonic.** Retention adjusts it via
   `lifetime_retired`. A naive cumulative line will dip and read as a bug. Either
   chart it as "lifetime (retention-adjusted)" with the dip explained, or do not
   chart it at all and keep it as a stat tile.

### Abuse note that gets worse when you publish a chart

The module header already states the model: a hostile client can mint install
ids and inflate counts. `(day, install_hash)` caps a _real_ install at one row
per day; it does not cap a _fabricated_ one. Publishing a growth chart makes
inflation more rewarding, because a chart is a vanity target in a way a JSON
blob is not.

This does not need identity or attestation to be acceptable — it needs honesty
and bounded damage:

- Keep the global `maxPingsPerDay` cost cap (currently 25,000). It bounds spend
  and bounds the size of any single day's distortion.
- Say plainly on the page that the numbers are anonymous, best-effort, and
  inflatable by anyone willing to fake pings. A number presented without that
  caveat implies a rigour the design deliberately does not buy.
- Consider a visible anomaly marker rather than silent smoothing: if a day is a
  large multiple of the trailing median, mark it, do not quietly flatten it.
  Smoothing hides the attack; marking documents it.

**Do not add per-IP rate limiting to buy integrity here.** `ingest.ts` never
reads a client IP by design, and that is the stronger privacy position. Trading
it for partial abuse resistance on a vanity metric is a bad trade — write the
caveat instead.

### Charts worth building

| Chart                      | Form                                           | Why                                                                                                                                | Needs         |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Version adoption over time | Stacked area, share per day                    | "Does a release actually propagate, and how fast?" The most actionable question this dataset can answer                            | series        |
| Active installs            | Single line                                    | "Is this growing?"                                                                                                                 | series        |
| Release propagation        | Stat tile — share of active installs on latest | One honest KPI; degrades gracefully when sparse                                                                                    | snapshot only |
| OS / arch                  | Ranked bars (**keep as-is**)                   | Categorical comparison over a handful of buckets with no meaningful trend. The existing `share-bars.tsx` is already the right form | snapshot only |

`share-bars.tsx` is well built — a real `<table>`, value beside every bar,
nothing reachable by colour alone, and a comment explaining why it is not a
stacked ribbon. **Extend that standard to the new charts; do not replace it.**
Every new chart needs a table view or adjacent values for the same reason.

Sparse-data behaviour is a requirement, not a polish item: a brand-new deploy
has one day of history and possibly one bucket above the floor. Every chart must
read correctly at n=1 day.

---

## Track B — Per-route social cards

### What we have

Better than expected. `buildPageMetadata()` is a shared helper and every route
already emits a complete set: `og:title`, `og:description`, `og:url`,
`og:site_name`, `og:type`, `og:image` with `width`/`height`/`alt`, and
`twitter:card = summary_large_image`. Verified live on `/`,
`/docs/users/getting-started`, `/analytics`, and `/releases`. The image is
1200x630 PNG at 68 KB with `content-type: image/png` — comfortably inside
WhatsApp's limits.

`/w/[code]` already generates a per-title `og:title` ("<Title> — shared with
Kunai") and is correctly `noindex`.

### The actual gap

**One generic image for every route.** Sharing a `/w/<code>` link for a specific
title on WhatsApp shows a card reading "Terminal-first playback guides". The
title is in `og:title` but not in the picture, and the picture is what a person
looks at.

### What we need

`app/w/[code]/opengraph-image.tsx` — decode the share code and render the title
into `KunaiSocialCard`. The decoder is pure and already used by
`generateMetadata` in the same route, so the data is in hand.

Constraints:

- **Do not fetch remote poster art inside `ImageResponse`.** It makes unfurl
  latency depend on TMDB/AniList, fails open-endedly, and quietly tells those
  services that a given title was shared. Render the title and position on the
  brand card instead.
- An invalid code must render the generic card, never throw. `generateMetadata`
  already has the `if (!shared)` branch to mirror.
- Keep the mascot inlining approach from `app/opengraph-image.tsx`; the
  filesystem-probe problem it documents applies identically here.

Secondary, lower value: distinct cards for `/analytics` and `/releases/[tag]`
(release tag in the image is genuinely useful when a release is shared).

---

## Sequencing

1. Track B share cards — self-contained, no schema work, immediate user-visible
   payoff on every shared link.
2. Track A series endpoint plus the window-consistent suppression rule and its
   tests.
3. Track A charts, once the endpoint is real. Build against the sparse case
   first.

## Out of scope

Per-IP rate limiting, client attestation, and any new payload field. Each trades
the privacy posture for integrity on a metric that does not warrant it.

See [.docs/analytics-privacy-contract.md](../.docs/analytics-privacy-contract.md)
for the consent and payload contract, which none of this changes.
