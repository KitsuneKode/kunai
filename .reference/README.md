# Reference — live, but never imported

Material that is **current and load-bearing**, but is not part of the shipped
runtime. This is not an archive: nothing here is superseded, and `.docs/` and
runtime source both cite it as authority.

**No active code imports anything under `.reference/`.**
`apps/cli/test/unit/architecture/boundary-imports.test.ts` fails if it starts to,
and the release build guard in `apps/cli/scripts/build-shared.ts` rejects any
release graph containing these paths.

## What is here

| Folder         | Was                 | Is                                                 |
| -------------- | ------------------- | -------------------------------------------------- |
| `design/`      | `.design/`          | Design authority for CLI surfaces and brand assets |
| `experiments/` | `apps/experiments/` | Provider research lab and scratchpads              |

### `design/`

Visual authority for terminal surfaces. `.docs/design-system.md` routes to the
specific board for a surface, and runtime source cites the locked ones directly —
for example `apps/cli/src/app-shell/calendar-view.ts` names
`.reference/design/cli/kunai-sakura-calendar-locked.html` as its design authority.

When implementation deliberately changes a contract, update the board in the same
change set.

### `experiments/`

`@kunai/experiments` — a private package that is **deliberately outside the
default workspace**, with its own lockfile, so provider research never pulls
dependencies into the shipped CLI. Install it explicitly:

```sh
bun run experiments:install
bun run experiments:list
```

Scratchpad reports are evidence for dossiers and implementation handoffs, not
production imports. A provider module living here is research until it appears in
`loadProductionProviderModules()` in
`apps/cli/src/container/bootstrap-providers.ts`.

## Related

| Looking for                 | Read                                                      |
| --------------------------- | --------------------------------------------------------- |
| Superseded history          | [`.archive/`](../.archive/README.md)                      |
| Provider research write-ups | [`.docs/provider-dossiers/`](../.docs/provider-dossiers/) |
| How to take a provider live | [`.docs/provider-intake.md`](../.docs/provider-intake.md) |
| Design tokens that ship     | `packages/design` — that is code, not reference           |
