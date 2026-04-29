# Kunai Agent Prompts

Use this folder to route focused work to fresh or Day-1 agents without reloading the whole Kunai product vision.

## Current Operating Rule

Prefer fewer agents with coherent ownership.

- Use one fresh docs/provider agent for all dossiers and doc drift cleanup.
- Use one Day-1/runtime-aware agent for MPV IPC, player telemetry, and playback history sign-off.
- Keep principal architecture/provider extraction separate until IPC/history are stable.

Do not run two agents that edit the same runtime seam at the same time.

## Prompt Files

- `fresh-provider-dossiers-and-docs-cleanup.md`
  - Best for one fresh docs/research agent.
  - Converts experiments into provider dossiers and cleans stale docs.
  - Does not edit production provider code.

- `day1-mpv-ipc-telemetry.md`
  - Best for the Day-1/runtime-aware agent.
  - Fixes the playback telemetry issue blocking real history persistence.
  - Owns MPV IPC/player progress foundation.

- `operating-model.md`
  - Explains how to run agents from here without over-distributing work.
