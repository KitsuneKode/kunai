---
status: current
lastReviewed: "2026-07-29"
---

# Kunai — Provider Intake Playbook

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this doc when researching a new provider, hardening an existing provider, or debugging provider drift after a site change.

This is the repo's default workflow for provider work:

1. gather inputs from the developer
2. produce a structured dossier
3. review knowns vs unknowns
4. hand off to implementation
5. keep regression notes and sample cases

Do not skip straight to scraper code unless the change is truly tiny and low-risk.

For concrete starting shapes and copyable patterns, also use:

- [.docs/provider-examples.md](./provider-examples.md)
- [.docs/templates/provider-playwright-pattern.md](./templates/provider-playwright-pattern.md)
- [.docs/templates/provider-api-pattern.md](./templates/provider-api-pattern.md)

## Dossier First

For new providers and major provider rewrites, the required output is a structured markdown dossier before implementation begins.

The dossier should answer:

- what the site appears to support
- what we know for sure
- what we only suspect
- what sample titles and flows were tested
- what network and DOM evidence was observed
- what runtime contract Kunai should implement

Use the template at [.docs/templates/provider-research-dossier.md](./templates/provider-research-dossier.md).

## Inputs Required From The Developer

The person requesting provider work should try to provide:

- provider/site name
- the exact goal:
  - new provider
  - harden existing provider
  - fix breakage
  - add subtitles / quality / dub support
  - inventory all mirrors or stream sources
- 2-3 known-good sample URLs or titles
- at least one movie and one episodic example if supported
- screenshots or screen recordings of the intended user flow if the UI is odd
- any previously known notes, quirks, or old research
- what success looks like
- what is already known to work
- what is known not to work

Nice-to-have inputs:

- expected quality options
- dub vs sub expectations
- subtitle availability expectations
- whether the site uses nested iframes, click-to-activate players, or API calls
- any cookies, referer requirements, or anti-bot notes already discovered

## Research Phase Deliverables

Before implementation, the research phase should deliver:

- a completed provider dossier
- knowns vs unknowns called out clearly
- sample titles and URLs recorded
- screenshots referenced or stored
- iframe chain and final player path described
- relevant network findings summarized
- candidate streams, subtitles, qualities, and audio variants listed when available
- referer/header/click requirements documented
- open questions left for implementation identified explicitly

## Implementation Handoff

After the dossier exists, the implementation handoff should state:

- which provider type is appropriate:
  - `PlaywrightProvider`
  - `ApiProvider`
  - hybrid API + embed scrape
- what the runtime should extract:
  - one winning stream only
  - stream inventory
  - subtitle tracks
  - quality labels
  - dub/sub variants
- what diagnostics should be emitted
- what sample titles should be used for regression checks

## Research Checklist

For each provider, gather as many of these as are relevant:

- landing page and canonical URL patterns
- season and episode navigation flow
- player activation steps
- iframe chain
- nested embed chain
- XHR / fetch / GraphQL calls tied to stream discovery
- media manifests and subtitle requests
- quality labels
- audio language or dub indicators
- subtitle track inventory and formats
- referer/header/cookie needs
- anti-bot challenges or timing quirks
- all candidate mirrors exposed by the site

## Known vs Unknown Discipline

The dossier should keep separate sections for:

- `Known`: backed by direct evidence
- `Unknown`: not yet verified
- `Suspected`: likely, but not confirmed

This keeps implementation honest and makes later drift diagnosis much easier.

## Output Storage

Recommended repo artifacts for a provider effort:

- dossier: `.docs/provider-dossiers/<provider-id>.md`
- plan work: `.plans/provider-hardening.md`
- runtime contract notes: update [.docs/providers.md](./providers.md) if the provider model changes

If a dossier does not yet exist, create one from the template before implementation work starts.

## Regression Notes

Every hardened provider should preserve:

- sample titles and URLs
- one or more tricky cases:
  - dub
  - subtitles
  - quality variants
  - multiple mirrors
  - anime episode mapping
- what evidence was most useful during research
- what is likely to drift first

## Privacy And Safety

- keep diagnostics and research notes local unless the user explicitly shares them
- avoid storing raw token-bearing URLs in reusable docs
- redact cookies, auth-like headers, and sensitive local paths from durable documentation

## Recommended Split Of Work

Use two passes when possible:

### Pass 1: Research Agent

- gather evidence
- fill the dossier
- avoid writing scraper code unless the task explicitly requires it

### Pass 2: Implementation Agent

- read the dossier
- implement the provider in repo contracts
- preserve diagnostics and sample fixtures
- update docs if the contract changed
