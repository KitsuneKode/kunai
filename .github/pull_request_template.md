## What changed

<!-- One sentence. -->

## Verification evidence

<!-- Give the tested commit, exact commands and outcomes. Identify skipped suites,
cache replays, and native/live checks not exercised. For a regression, name the
failing input and the test that fails when the fix is removed. For UI changes,
include the relevant frames and input/resize/reverse-state checks. -->

## Checklist

- [ ] Changeset added (`bun run changeset`) — required for user-facing CLI changes; N/A for docs-only or non-release infra
- [ ] `bun run guard` passes when `apps/cli/package.json`, changelogs, or `.changeset/**` changed
- [ ] `bun run fmt && bun run lint && bun run test && bun run typecheck` passes locally
- [ ] `bun run build` passes for feature, playback, provider, release, or packaging-sensitive changes
- [ ] Live provider or Discord smokes were skipped intentionally, or run manually with results noted
