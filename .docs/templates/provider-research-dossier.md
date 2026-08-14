---
status: current
lastReviewed: "2026-04-23"
---

# Provider Research Dossier Template

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this template for new providers and major provider hardening passes.

## Request Summary

- Provider:
- Requested by:
- Date:
- Goal:
- Success criteria:

## Inputs Supplied By Developer

- Sample titles / URLs:
- Screenshots / recordings:
- Known requirements:
- What already works:
- What is broken or missing:

## Scope

- Content types:
  - movie:
  - series:
  - anime:
- Features requested:
  - multi-source inventory:
  - subtitles:
  - quality variants:
  - dub / audio variants:

## Known

- Evidence-backed findings only.

## Suspected

- Likely findings that still need confirmation.

## Unknown

- Open questions that implementation must not assume away.

## User Flow

Describe the normal user path from title page to playable stream.

## URL Patterns

- Landing page:
- Episode page:
- Embed page:
- API endpoints:

## DOM And Interaction Notes

- Buttons/selectors:
- Needs click:
- Season/episode controls:
- Mirror/provider controls:
- Quality/audio/subtitle controls:

## Network Findings

- Relevant XHR/fetch/API calls:
- Relevant manifest requests:
- Relevant subtitle requests:
- Any anti-bot or redirect behavior:

## Embed / Iframe Chain

1.
2.
3.

## Candidate Stream Inventory

List all candidate streams or mirrors observed, not just the first successful one.

| Candidate | Source host | Quality | Audio | Subs | Evidence | Notes |
| --------- | ----------- | ------- | ----- | ---- | -------- | ----- |

## Subtitle Inventory

| Track | Language | Format | Source | Notes |
| ----- | -------- | ------ | ------ | ----- |

## Headers / Referer / Cookies

- Referer requirements:
- Header requirements:
- Cookies or anti-bot state:

## Runtime Contract Recommendation

- Provider kind:
- What should be extracted:
- What should be deferred:
- Diagnostics needed:

## Sample Cases For Regression

- Movie case:
- Series case:
- Anime case:
- Subtitle case:
- Dub/audio case:
- Multi-mirror case:

## Risks And Drift Watchlist

- What is likely to change first:
- What evidence should be re-collected if it breaks:

## Implementation Handoff Notes

- Shared helpers that may be reusable:
- Open implementation questions:
- Things the next agent should not assume:
