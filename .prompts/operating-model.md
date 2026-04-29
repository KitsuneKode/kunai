# Kunai Agent Operating Model

This is how to handle Kunai work from here without scattering context across too many agents.

## The Rule

Run fewer agents with clearer ownership.

Good:

- One fresh documentation/research agent owns all provider dossiers and docs drift.
- One Day-1/runtime agent owns MPV IPC, telemetry, playback history, and post-playback runtime bugs.
- One principal agent owns `@kunai/core` extraction after playback telemetry/history are stable.

Bad:

- Four agents all touching providers.
- One agent editing docs while another edits the same docs.
- Provider extraction while MPV/history QA is still blocked.
- Fresh agents rewriting runtime code from scratchpads.

## Current Priority

1. Fix MPV telemetry / IPC enough for real history persistence.
2. Finish provider dossiers and subtitle-resolution documentation.
3. Re-run Phase 3 runtime QA.
4. Only after that, start Phase 4 `@kunai/core`.

## Why Not Do `@kunai/core` Immediately?

The provider-core boundary depends on trustworthy playback outcomes:

- history saves
- auto-next
- provider health
- source confidence
- fallback traces

If MPV says `{0,0,eof}` after real playback, provider health and recovery logic will be built on bad evidence. Fix the player truth layer first.

## Can One Fresh Agent Do All Dossiers?

Yes. That is preferable right now.

One fresh agent can build a coherent cross-provider picture:

- same dossier format
- same subtitle section
- same confidence language
- fewer repeated reads
- fewer conflicting docs

The boundary is simple: that agent writes docs only. No production provider rewrites.

## Parallel Work That Is Safe

Safe in parallel:

- Day-1 agent: MPV IPC / telemetry.
- Fresh docs agent: provider dossiers and docs cleanup.

Not safe in parallel:

- MPV IPC and post-playback shell rewrites by different agents.
- Provider implementation changes while dossiers are still being written.
- `@kunai/core` extraction while provider dossiers and player telemetry are both unstable.

## Handoff Rhythm

Use this cadence:

1. Assign one prompt.
2. Agent commits or reports clearly.
3. Run a small review.
4. Only then start the next runtime-affecting phase.

For code work, prefer one commit per phase.

For docs work, one commit can contain all dossiers if the agent stayed doc-only.

## Immediate Delegation

Start now:

- Fresh docs agent: `.prompts/fresh-provider-dossiers-and-docs-cleanup.md`
- Day-1 runtime agent: `.prompts/day1-mpv-ipc-telemetry.md`

Hold:

- Phase 4 `@kunai/core` extraction until MPV telemetry/history sign-off is no longer blocked.
