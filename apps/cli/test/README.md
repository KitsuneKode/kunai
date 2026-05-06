# Test Layout

Use the test tree by responsibility:

- `src/**/*.test.ts`
  Pure and local unit tests that stay closest to the module they protect.
- `test/integration/`
  Deterministic workflow or service contract tests that span multiple modules.
- `test/live/`
  Opt-in live smoke scripts for provider drift or real network verification.
- `test/templates/`
  Copyable starting points for new provider and service contract tests.
- `test/vhs/`
  VHS tapes and golden outputs for shell UX demos and visual regression capture.

The npm package already excludes this tree because `package.json` only publishes:

- `dist`
- `README.md`
- `LICENSE`

So these tests are safe to keep in-repo without shipping them to npm.

## Recommended Commands

- `bun run test`
- `bun run test:integration`
- `bun run test:live:allanime`
- `bun run test:live:miruro`
- `bun run test:live:providers`
- `bun run test:live:rivestream`
- `bun run test:live:vidking`
- `bun run test:vhs:browse`
- `bun run test:vhs:help`
