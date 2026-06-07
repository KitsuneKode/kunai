## What changed

<!-- One sentence. -->

## Checklist

- [ ] Changeset added (`bun run changeset`) — required for user-facing CLI changes; N/A for docs-only or non-release infra
- [ ] `bun run guard` passes when `apps/cli/package.json`, changelogs, or `.changeset/**` changed
- [ ] `bun run fmt && bun run lint && bun run test && bun run typecheck` passes locally
- [ ] `bun run build` passes for feature, playback, provider, release, or packaging-sensitive changes
- [ ] Live provider or Discord smokes were skipped intentionally, or run manually with results noted
