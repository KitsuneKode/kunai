# Plan 005: CLI Args and State Library Decisions

Status: implemented
Priority: P2
Effort: S-M
Risk: Low-Medium
Created: 2026-06-22

## Implemented Slice

Landed in the 2026-06-22 architecture pass:

- Moved argv parsing and help text ownership into `apps/cli/src/cli-args.ts`.
- Kept `main.ts` compatibility exports for older tests/imports while making launch orchestration the only meaningful owner in `main.ts`.
- Added direct tests for `buildCliHelpText` and kept the existing parser behavior tests against the extracted parser.
- Decided not to add Commander yet: the current parser is isolated and tested, and Commander can be adopted later if subcommands/help behavior outgrows this module.
- Decided not to add Zustand for canonical session state: continue using `SessionStateManager` and `useSessionSelector`, with any future Zustand-like store limited to proven ephemeral shell UI state.

Remaining follow-up:

- Reconsider Commander after the action dispatcher and state ownership plans are complete.
- Delete the `main.ts` compatibility parser exports once callers/tests import `cli-args.ts` directly.

## Decision Summary

Commander is a reasonable future dependency for CLI parsing. Zustand is not recommended for canonical Kunai session state right now.

Local package evidence:

- `apps/cli/package.json` currently ships only `ink` and `react` as runtime dependencies.
- `apps/cli/src/main.ts` has a custom `parseArgs(argv)` function and CLI help text in the same large runtime file.
- `apps/cli/src/app-shell/use-session-selector.ts` already provides a `useSyncExternalStore` selector bridge over `SessionStateManager`.
- Current npm metadata checked on 2026-06-22:
  - `commander@15.0.0`, MIT, unpacked size about 207 KB, no reported dependencies from `npm view`.
  - `zustand@5.0.14`, MIT, unpacked size about 95 KB, peer dependencies include React and `use-sync-external-store`.

## Commander Recommendation

Adopt Commander only for CLI entry parsing, subcommands, help, and validation, after the P0 input/command dispatcher work lands.

Why it is worth considering:

- The current parser in `main.ts` is hand-written and keeps growing.
- `upgrade`, `uninstall`, protocol setup, offline, history, download, and debug flags are becoming command/option surfaces with real UX expectations.
- Commander can make unknown-option handling, missing-value errors, aliases, subcommands, and help generation less bespoke.
- Moving parser code into a dedicated `cli-args.ts` reduces `main.ts` ownership confusion.

Risks:

- Importing Commander at the top of `main.ts` can weaken the current fast `--help` and `--version` path.
- Generated help text may drift from Kunai's current product wording unless explicitly tested.
- Commander should not own app command palette behavior; it is for process argv only.

Recommended design:

```ts
// apps/cli/src/cli-args.ts
export type CliArgs = {
  /* current parseArgs result */
};

export function parseCliArgs(argv: readonly string[]): CliArgs;
export function buildCliHelpText(): string;
```

Implementation rules:

- Keep `runCli` fast paths for `--version` and `--help` before heavy container creation.
- If Commander import cost matters, lazy import `cli-args.ts` after the trivial version check.
- Preserve current behavior for bare search positionals: `kunai "Dune"`.
- Preserve warnings or convert them to structured parse errors with tests.
- Keep protocol handoff mutation outside Commander; it is post-parse app launch logic.

Tests:

- `parseCliArgs(["--version"])` sets version without loading the container.
- `parseCliArgs(["Dune Part Two"])` produces `search: "Dune Part Two"`.
- `parseCliArgs(["--type", "tv"])` normalizes to `series`.
- missing value warnings/errors are stable.
- unknown option handling is stable.
- help text includes the same canonical flags as the parser.

Verification:

```sh
bun run --cwd apps/cli test:file test/unit/cli-args.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

Acceptance criteria:

- `main.ts` no longer owns low-level option parsing.
- Help/version paths still avoid container creation.
- No command palette, keybinding, or app command behavior is coupled to Commander.
- User-facing CLI flag behavior is unchanged except for intentionally improved error text.

## Zustand Recommendation

Do not move canonical session state to Zustand in the near term.

Why not:

- Kunai already has a domain-specific reducer and `SessionStateManager`.
- `useSessionSelector` already solves the React subscription problem without another runtime dependency.
- Adding Zustand for `SessionState` would create another source of truth beside reducer dispatch.
- The main issue is inconsistent adoption of existing state primitives, not absence of a state library.

Where Zustand could be reconsidered:

- A small app-shell-only UI store for ephemeral concerns that should not live in domain session state:
  - command palette input
  - transient focus context
  - local layout measurements
  - hover/selection state not relevant to playback/session logic

Decision gate before adopting Zustand:

- At least two surfaces need shared ephemeral UI state.
- That state is not appropriate for `SessionState`.
- Passing it through props or `useSessionSelector` creates measurable complexity.
- A pure local store removes code instead of adding parallel ownership.

Preferred current path:

- Execute Plan 003 first.
- Use `SessionStateManager` for domain/session truth.
- Use local React state for private component state.
- Use a tiny focused external store only if Plan 003 exposes repeated ephemeral cross-surface state.

## Alternatives

- Keep custom parser, but move it to `cli-args.ts`: lower dependency cost, but preserves parser maintenance burden.
- Use a tiny parser such as `parseArgs` from Node util: less featureful and less aligned with Bun-first CLI ergonomics.
- Use no state library: current recommendation for domain state.
- Use Zustand only for ephemeral shell UI: acceptable later if it removes real code.

## Implementation Order

1. Finish Plan 001 and Plan 002 first so app commands and runtime input are canonical.
2. Finish at least the first slice of Plan 003 so state ownership is clearer.
3. Migrate args to `cli-args.ts`; choose Commander only if tests show it reduces custom parser code without changing behavior.
4. Revisit Zustand only after root shell subscriber removal is underway.
