# KitsuneSnipe — Provider Examples And Demo Patterns

Use this doc when an agent needs a concrete starting point for a new provider or a hardening pass.

This file exists to reduce improvisation. It does not replace the provider dossier workflow. It gives agents a set of example shapes and a recommended order of attack.

Start here alongside:

- [.docs/provider-intake.md](./provider-intake.md)
- [.docs/provider-agent-workflow.md](./provider-agent-workflow.md)
- [.docs/providers.md](./providers.md)
- [.docs/templates/provider-playwright-pattern.md](./templates/provider-playwright-pattern.md)
- [.docs/templates/provider-api-pattern.md](./templates/provider-api-pattern.md)

## Rule Zero

Do not write scraper code from vibes.

For non-trivial work:

1. gather evidence
2. create or update the dossier
3. choose the nearest provider pattern
4. implement the narrowest provider contract that matches the evidence
5. add or update fixtures and tests

## Existing Repo References

Use existing providers as anchors before inventing a new shape.

| Pattern                                    | Reference file                                                                                                       | When to copy the shape                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Playwright embed capture                   | [src/providers/vidking.ts](/home/kitsunekode/Projects/hacking/kitsunesnipe/src/providers/vidking.ts)                 | Site builds a stable page or embed URL and the real stream appears during runtime      |
| Playwright with activation click           | [src/providers/cineby.ts](/home/kitsunekode/Projects/hacking/kitsunesnipe/src/providers/cineby.ts)                   | The page must be activated before the stream request happens                           |
| API-first with browser-assisted final step | [src/providers/braflix.ts](/home/kitsunekode/Projects/hacking/kitsunesnipe/src/providers/braflix.ts)                 | Search or metadata come from HTTP or GraphQL, but the final embed still needs scraping |
| Shared anime parity helper                 | [src/providers/allanime-family.ts](/home/kitsunekode/Projects/hacking/kitsunesnipe/src/providers/allanime-family.ts) | The site follows the same ani-cli-style contract or decoding path                      |

## Pattern 1: Playwright Embed Provider

Use this when:

- the site exposes a title or episode page
- the real `.m3u8` only appears after running browser JS
- there is little or no stable API for final stream resolution

Typical workflow:

1. determine URL construction rules
2. determine whether activation click is needed
3. determine iframe or embed chain
4. confirm the stream request and subtitle requests in the network log
5. implement the smallest provider that can build the URL and hand off to the scraper

Copy shape from:

- [.docs/templates/provider-playwright-pattern.md](./templates/provider-playwright-pattern.md)

## Pattern 2: API-First Provider With Embed Fallback

Use this when:

- the site exposes metadata or player bootstrap data over HTTP or GraphQL
- the site still requires a final embed or player load to reveal the actual media URL

Typical workflow:

1. capture the search or metadata requests
2. map the provider's title or episode identifiers
3. resolve the final embed URL or player bootstrap payload
4. delegate the last-mile browser scrape when needed

Copy shape from:

- [.docs/templates/provider-api-pattern.md](./templates/provider-api-pattern.md)

## Pattern 3: Multi-Candidate Inventory Provider

Use this when the site exposes:

- multiple mirrors
- multiple stream hosts
- multiple quality variants
- separate dub or audio options
- subtitles from more than one source

Recommended approach:

1. inventory all candidate sources before picking a winner
2. preserve source metadata:

- host
- quality
- audio language
- subtitle availability
- evidence

3. rank candidates later in the resolution layer instead of throwing away useful information early

If you discover multiple candidates but the current runtime can only return one stream, still capture the inventory in the dossier and diagnostics notes.

## Pattern 4: Subtitle-Aware Provider

When subtitle support matters, gather:

- subtitle request URLs
- format types like `vtt`, `srt`, or `ass`
- whether tracks are attached at player bootstrap time or later
- whether subtitle availability differs by mirror or audio selection

Do not treat subtitle extraction as an afterthought. If the site exposes it, preserve it in the evidence and tests.

## Recommended Agent Workflow

### Research pass

- collect sample titles and URLs
- capture screenshots and odd UI interactions
- note selectors, buttons, iframes, and mirror controls
- collect network evidence
- fill in `Known`, `Suspected`, and `Unknown`

### Implementation pass

- choose the closest provider pattern
- implement the narrowest provider contract that fits
- extract shared helpers when duplication starts to appear
- keep diagnostics explicit
- add fixtures for parsing or extraction behavior

### Hardening pass

- expand beyond the first discovered stream
- add quality, subtitle, and audio metadata
- capture drift points
- improve test coverage and sample cases

## New Provider Checklist

- dossier created or updated
- provider type chosen with evidence
- sample titles recorded
- candidate inventory documented when applicable
- subtitle handling documented when applicable
- referer, header, cookie, and click requirements noted
- tests added at the parser or service level where practical
- provider matrix and docs updated if capabilities changed

## Testing Expectations

For new provider work, aim to leave behind:

- dossier-backed fixtures
- parser or extraction tests
- one focused integration or contract test when needed
- explicit notes about what still requires live verification

Use [.docs/testing-strategy.md](./testing-strategy.md) for the full testing rules.
