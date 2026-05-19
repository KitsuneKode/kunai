# Provider Evidence Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider contract changes evidence-backed and regression-resistant.

**Architecture:** Store sanitized fixture payloads and normalized expected outputs for each provider capability. Tests should prove raw provider facts become stable typed contracts without live provider calls.

**Tech Stack:** Bun tests, `packages/providers/test`, fixture JSON.

---

## Agent Tracking Header

```text
SLICE_ID: P3
SLICE_STATUS: in-progress
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-18
SLICE_CURRENT_TASK: P3-T4
SLICE_BLOCKERS: none
```

## File Ownership

Create directories as needed:

- `packages/providers/test/fixtures/allmanga/`
- `packages/providers/test/fixtures/miruro/`
- `packages/providers/test/fixtures/vidking/`
- `packages/providers/test/fixtures/rivestream/`

Modify:

- `packages/providers/test/allmanga.test.ts`
- `packages/providers/test/providers.test.ts`
- provider dossier docs only to reference fixture origin and stability.

Do not put secrets, cookies, bearer tokens, or complete signed expiring URLs in fixtures. Redact or replace with stable examples.

## Required Fixture Matrix

- AllManga search result with `malId` and `aniListId`.
- AllManga sub/dub episode source list.
- Miruro source list with subtitle and thumbnail evidence if available.
- VidKing/Rivestream server inventory with language/source labels.
- At least one negative fixture: no stream, blocked host, expired locator, or parse-missing field.

## Tasks

### P3-T1: Add AllManga Fixtures

- [x] Add search fixture with `malId` and `aniListId`.
- [x] Add sub/dub source inventory fixture.
- [x] Add expected normalized contract output fixture.
- [x] Add tests proving IDs and sub/dub/server labels survive normalization.
- [x] Run `bun run --cwd packages/providers typecheck`.
- [x] Run `bun run --cwd packages/providers test`.
- [x] Commit with message `test(providers): add allmanga evidence fixtures`.

Completed in `e1ed60a`.

### P3-T2: Add Series/Movie Provider Fixtures

- [x] Add VidKing fixture with source/server labels and quality evidence.
- [x] Add Rivestream fixture with source/server labels and quality evidence.
- [x] Add expected normalized contract outputs.
- [x] Add tests proving native labels are preserved separately from normalized language fields.
- [x] Run `bun run --cwd packages/providers typecheck`.
- [x] Run `bun run --cwd packages/providers test`.
- [x] Commit with message `test(providers): add series provider evidence fixtures`.

Completed in `b38179f`.

### P3-T3: Add Miruro Fixture

- [x] Add Miruro fixture with source list, subtitles, and thumbnail evidence if the research payload proves it.
- [x] If thumbnail evidence is absent, add a dossier note saying the field remains unsupported.
- [x] Add tests for available fields only.
- [x] Run `bun run --cwd packages/providers typecheck`.
- [x] Run `bun run --cwd packages/providers test`.
- [x] Commit with message `test(providers): add miruro evidence fixtures`.

Completed in `50b711a`.

### P3-T4: Add Negative Fixtures

- [ ] Add one no-stream or blocked-host fixture.
- [ ] Add one expired locator or parse-missing fixture.
- [ ] Assert these produce structured failures, not thrown generic errors.
- [ ] Run `bun run --cwd packages/providers test`.
- [ ] Commit with message `test(providers): add negative provider fixtures`.

## Stop Conditions

- Stop if a fixture requires live credentials or private cookies.
- Stop if a provider dossier claim cannot be supported by a sanitized payload.
- Stop if a fixture shows a byte-affecting field missing from planned cache identity.

## Acceptance Tests

- Fixtures prove ID preservation.
- Fixtures prove source/server labels are preserved.
- Fixtures prove normalized language fields do not replace native labels.
- Fixtures prove provider-local cycle failures are traceable.
