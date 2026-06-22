# Plan 006: Package Seam Guards and Provider Materialization

Status: ready
Priority: P0
Effort: S-M
Risk: Low-Medium
Created: 2026-06-22

## Problem

The runtime map says infra owns mpv, IPC, process, filesystem, and terminal mechanics. It must not own provider facts or source extraction details. The current code has provider-aware media materialization under `apps/cli/src/infra/player`, which imports `@kunai/providers`.

This is a shallow seam: infra callers need to know provider-specific materialization exists, and provider package internals leak into player mechanics.

## Goal

Make package ownership executable with tests and move provider-aware materialization behind a playback-service seam.

## Non-Goals

- Do not rewrite provider adapters.
- Do not change mpv playback behavior.
- Do not change AllManga Ak locator semantics.
- Do not add new package dependencies.

## Design

Keep low-level file mechanics local, but move provider interpretation out of `infra/player`.

Target shape:

```text
services/playback
  playback-media-materializer.ts
  deferred-media-materializer.ts
  hls-manifest-materializer.ts

infra/player
  consumes already-materialized StreamInfo
  owns mpv handoff only
```

The playback materializer may import `@kunai/providers` because services coordinate playback work and provider result facts. Infra should not.

## Implementation Steps

1. Extend `apps/cli/test/unit/architecture/boundary-imports.test.ts`.
   - Assert `apps/cli/src/infra` does not import `@kunai/providers`.
   - Keep the failure message as `file -> specifier`.
2. Run that test and confirm it fails on existing materializer imports.
3. Move provider-aware materializer files from `apps/cli/src/infra/player` to `apps/cli/src/services/playback`.
4. Update call sites and tests.
5. Leave pure player mechanics under `infra/player`.
6. Run focused tests, then full gates.

## Tests

- `apps/cli/test/unit/architecture/boundary-imports.test.ts`
- `apps/cli/test/unit/services/playback/deferred-media-materializer.test.ts`
- `apps/cli/test/unit/services/playback/hls-manifest-materializer.test.ts`
- Existing player tests that call playback handoff paths.

## Verification

```sh
bun run --cwd apps/cli test:file test/unit/architecture/boundary-imports.test.ts
bun run --cwd apps/cli test:file test/unit/services/playback/deferred-media-materializer.test.ts
bun run --cwd apps/cli test:file test/unit/services/playback/hls-manifest-materializer.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

## Acceptance Criteria

- `apps/cli/src/infra` has no direct `@kunai/providers` imports.
- Provider-aware media materialization sits under playback services.
- Existing materializer behavior is unchanged.
- The boundary guard fails if future infra files import providers directly.
