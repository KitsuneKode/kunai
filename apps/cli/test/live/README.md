# Live Provider Smoke Checks

Live provider tests are opt-in reality checks. They are useful when provider drift, CDN behavior, subtitle availability, or a release candidate needs confirmation, but they must not be required for the default test path.

Each smoke script creates an isolated temporary XDG profile for config, data, and cache. The JSON output includes `isolatedProfile: true` and a `/tmp/kunai-live-*` `profileRoot` so reviewers can verify it did not touch the real application database.

Run them only when network access is intentional. Prefer one focused provider while debugging, then the full set once at the end of a release-candidate pass:

```sh
bun run test:live:vidking 1 2
bun run test:live:rivestream
bun run test:live:allanime "Kimetsu no Yaiba" SJms742bSTrcyJZay
bun run test:live:miruro
```

Use `KITSUNE_CLEAR_CACHE=1` only when the point of the run is to prove a cold-cache provider path. Do not loop live smokes while iterating; add or update unit/integration coverage around the deterministic seam instead.

For each run, capture:

- provider id and selected runtime
- cache status: fresh, stale, validated, refetched, or miss
- stream candidate count and selected protocol
- subtitle candidate count and selected source
- timing for resolve, health check, and player startup
- redacted diagnostics export path when a failure needs reporting

Do not mark a provider down from a local offline/DNS failure. Confirm general connectivity first, then compare the smoke output with `/diagnostics` and the provider attempt timeline before changing provider code.

Provider etiquette:

- keep live calls sparse and purposeful
- do not run live smokes in default CI
- do not hammer one title/provider while debugging
- prefer fixture payloads, mocked fetch ports, and recorded traces for repeated verification
- hold publish when the final live smoke pass shows provider drift that affects the intended release path
