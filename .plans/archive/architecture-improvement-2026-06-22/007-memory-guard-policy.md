# Plan 007: Memory Guard Policy

Status: implemented
Priority: P0
Effort: S
Risk: Low-Medium
Created: 2026-06-22

## Problem

The memory guard terminated Kunai on a single inclusive RSS sample at the default `1536MB` cap. That protected the machine from runaway allocation, but it was too harsh for long-running sessions and the message assumed a specific root cause: "runaway after the terminal closed."

## Implemented Policy

- Default cap increased to `3072MB`.
- Normal over-cap memory now needs two consecutive samples before termination.
- Emergency overshoot still terminates immediately at `1.5x` cap.
- Termination copy now says whether the reason was sustained over-cap memory or emergency overshoot instead of assuming the terminal-close runaway.
- Existing overrides still work:
  - `KUNAI_MEM_CAP_MB`
  - `KUNAI_NO_MEMORY_GUARD=1`

## Tests

- `apps/cli/test/unit/memory-watchdog.test.ts`
  - parses `/proc` RSS
  - honors cap override/default
  - allows one normal over-cap sample
  - terminates after sustained over-cap samples
  - terminates immediately on emergency overshoot

## Follow-Up

Add a diagnostics event or lightweight on-screen warning before the second over-cap sample if we can do that without relying on the main event loop. The current worker must remain able to terminate a jammed process.
