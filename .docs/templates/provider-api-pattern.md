---
status: current
lastReviewed: "2026-04-23"
---

# Provider Pattern Template — API First With Embed Fallback

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this as a copyable reference when the provider resolves metadata or player bootstrap data over HTTP or GraphQL, but may still need browser help for the final stream.

This is a pattern template, not a guaranteed drop-in implementation.

## When This Pattern Fits

- the site exposes searchable metadata or episode mapping over HTTP or GraphQL
- the final media URL may still require loading an embed or player page
- the provider needs both transport-level parsing and browser-assisted fallback

## Demo Shape

```ts
import type { ApiProvider } from "../../src/providers/types";

export const DemoApiProvider: ApiProvider = {
  kind: "api",
  id: "demo-api",
  description: "Reference-only API-first provider pattern",

  async search(query) {
    const response = await fetch(
      `https://example.invalid/api/search?q=${encodeURIComponent(query)}`,
    );
    const payload = await response.json();

    return payload.results ?? [];
  },

  async resolveStream(id, type, season, episode, opts) {
    const response = await fetch("https://example.invalid/api/player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, type, season, episode }),
    });

    const payload = await response.json();
    const embedUrl = payload.embedUrl;

    if (!embedUrl) return null;

    return opts.embedScraper(embedUrl);
  },
};
```

## Agent Notes

- separate "metadata mapping" from "final stream resolution"
- preserve the player bootstrap payload in the dossier if it contains subtitles, quality labels, or mirror inventory
- if the API already exposes multiple candidates, do not discard them before recording them

## Minimum Evidence To Gather

- search or episode lookup requests
- request and response shape for the player bootstrap or final embed lookup
- any required headers, tokens, or referers
- whether the embed step is optional or mandatory
- whether the API already exposes subtitles, audio variants, or quality metadata

## Test Guidance

- keep response-shape parsing in pure functions where possible
- preserve reduced fixture payloads for the metadata and bootstrap responses
- test rejection paths for malformed or partial payloads
