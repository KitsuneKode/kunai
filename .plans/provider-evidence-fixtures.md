# Provider Evidence Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider contract changes evidence-backed and regression-resistant.

**Architecture:** Store sanitized fixture payloads and normalized expected outputs for each provider capability. Tests should prove raw provider facts become stable typed contracts without live provider calls.

**Tech Stack:** Bun tests, `packages/providers/test`, fixture JSON.

---

## Agent Tracking Header

```text
SLICE_ID: P3
SLICE_STATUS: planned
SLICE_OWNER: unassigned
SLICE_LAST_UPDATED: 2026-05-18
SLICE_CURRENT_TASK: P3-T1
SLICE_BLOCKERS: fixture payload source confirmation
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

- [ ] Add search fixture with `malId` and `aniListId`.
- [ ] Add sub/dub source inventory fixture.
- [ ] Add expected normalized contract output fixture.
- [ ] Add tests proving IDs and sub/dub/server labels survive normalization.
- [ ] Run `bun run --cwd packages/providers test`.
- [ ] Commit with message `test(providers): add allmanga evidence fixtures`.

### P3-T2: Add Series/Movie Provider Fixtures

- [ ] Add VidKing fixture with source/server labels and quality evidence.
- [ ] Add Rivestream fixture with source/server labels and quality evidence.
- [ ] Add expected normalized contract outputs.
- [ ] Add tests proving native labels are preserved separately from normalized language fields.
- [ ] Run `bun run --cwd packages/providers test`.
- [ ] Commit with message `test(providers): add series provider evidence fixtures`.

### P3-T3: Add Miruro Fixture

- [ ] Add Miruro fixture with source list, subtitles, and thumbnail evidence if the research payload proves it.
- [ ] If thumbnail evidence is absent, add a dossier note saying the field remains unsupported.
- [ ] Add tests for available fields only.
- [ ] Run `bun run --cwd packages/providers test`.
- [ ] Commit with message `test(providers): add miruro evidence fixtures`.

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
