---
status: current
lastReviewed: "2026-04-23"
---

# Provider Pattern Template — Playwright Embed Capture

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this as a copyable reference when the provider is mostly "build a URL, load a page, intercept the real stream."

This is a pattern template, not a guaranteed drop-in implementation.

## When This Pattern Fits

- the site exposes a title, movie, or episode page
- the actual media URL appears only after browser execution
- the provider can be expressed as "construct URL, maybe click, then scrape"

## Demo Shape

```ts
import type { PlaywrightProvider } from "../../src/providers/types";

export const DemoPlaywrightProvider: PlaywrightProvider = {
  kind: "playwright",
  id: "demo-playwright",
  description: "Reference-only Playwright provider pattern",
  needsClick: false,

  buildUrl(id, type, season, episode) {
    if (type === "movie") {
      return `https://example.invalid/movie/${id}`;
    }

    return `https://example.invalid/tv/${id}/${season}/${episode}`;
  },
};
```

## Agent Notes

- verify whether the real page URL and the final embed URL are the same thing
- verify whether activation click is required
- verify whether subtitles are visible in network traffic or player bootstrap data
- verify whether the site exposes multiple mirrors before assuming "first stream wins"

## Minimum Evidence To Gather

- title-to-page URL shape
- episode URL shape if episodic
- iframe or embed chain
- whether a click is needed
- at least one observed stream request
- at least one observed subtitle request if subtitles are available

## Test Guidance

- keep URL-construction logic easy to test as a pure function
- preserve fixture notes for iframe or player bootstrap parsing
- do not rely only on manual live verification
