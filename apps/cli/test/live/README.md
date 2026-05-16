# Live Provider Smoke Checks

Live provider tests are opt-in reality checks. They are useful when provider drift, CDN behavior, subtitle availability, or a release candidate needs confirmation, but they must not be required for the default test path.

Run them only when network access is intentional:

```sh
KITSUNE_CLEAR_CACHE=1 KITSUNE_DEBUG=1 bun run test:live:vidking 1 2
KITSUNE_CLEAR_CACHE=1 KITSUNE_DEBUG=1 bun run test:live:rivestream
KITSUNE_CLEAR_CACHE=1 KITSUNE_DEBUG=1 bun run test:live:allanime
KITSUNE_CLEAR_CACHE=1 KITSUNE_DEBUG=1 bun run test:live:miruro
```

For each run, capture:

- provider id and selected runtime
- cache status: fresh, stale, validated, refetched, or miss
- stream candidate count and selected protocol
- subtitle candidate count and selected source
- timing for resolve, health check, and player startup
- redacted diagnostics export path when a failure needs reporting

Do not mark a provider down from a local offline/DNS failure. Confirm general connectivity first, then compare the smoke output with `/diagnostics` and the provider attempt timeline before changing provider code.
