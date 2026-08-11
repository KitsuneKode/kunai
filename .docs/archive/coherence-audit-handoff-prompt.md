# Kunai Coherence Audit — Agent Handoff Prompt

Use this prompt in a fresh agent session when you need a systematic pass over naming, duplication, package boundaries, and ownership drift. Pair it with `.docs/runtime-boundary-map.md` and `.plans/plan-implementation-truth.md`.

---

## Copy-paste prompt

```text
You are auditing Kunai (/home/kitsunekode/Projects/hacking/kitsunesnipe) for structural coherence.

Read first:
- .docs/runtime-boundary-map.md
- .docs/engineering-guide.md
- .plans/plan-implementation-truth.md
- apps/cli/src/container.ts (wiring truth)

Goals:
1. Naming and file conventions
2. Duplicate logic and parallel implementations
3. Wrong-layer imports and package boundary leaks
4. God files and extraction candidates
5. Whether a new package is justified vs in-place cleanup

## 1. Naming convention inventory

Scan apps/cli/src and packages/* for inconsistent naming:
- kebab-case files (browse-shell.tsx) vs PascalCase (ListRow.tsx)
- *.model.ts siblings vs inline types
- duplicate type names across layers (SearchResult, EpisodeInfo, ProviderMetadata)
- legacy root files (apps/cli/src/search.ts, tmdb.ts, mpv.ts, session-flow.ts)

Output a table: path | current convention | recommended convention | migrate now or defer

## 2. Duplicate logic finder

Search for duplicated business rules across:
- apps/cli/src/app vs apps/cli/src/domain vs apps/cli/src/services
- apps/cli/src/tmdb.ts vs services/catalog/TitleDetailService.ts vs services/recommendations/*
- completion threshold logic (domain/continuation vs services/continuation vs app/playback-policy)
- TMDB/search HTTP clients (search.ts vs SearchRegistry vs RecommendationServiceImpl)
- command surfaces (domain/session/command-registry.ts vs app-shell/commands.ts — allowed re-export vs true duplication)

For each duplicate cluster:
- list all file paths
- describe what differs (intentional adapter vs accidental drift)
- recommend: extract shared module | delete one path | document intentional split

Use ripgrep for function names, type names, and magic constants (e.g. 0.95 completion, videasy proxy URL).

## 3. Layer boundary violations

Enforce:
- app-shell: render + route intent only
- app: policy and phase orchestration
- domain: pure logic, no Ink/mpv/SQLite
- services: orchestration + persistence adapters
- infra: mpv/process/fs mechanics
- packages/providers: provider facts only
- packages/storage: SQLite only

Find imports that violate "must not own" rules in runtime-boundary-map.md.
Flag bidirectional app <-> app-shell imports.

## 4. Package placement decision tree

For each misplaced module, decide:
- stay in apps/cli (app-specific policy)
- move to packages/core (cross-surface contracts)
- move to packages/providers (provider-specific)
- move to packages/storage (persistence)
- new package only if: 3+ consumers, stable API, clear non-CLI future (daemon/web)

Do NOT recommend new packages for one-off helpers.

## 5. God file decomposition map

List files >500 lines in apps/cli/src. For each:
- responsibilities currently mixed
- proposed slice modules
- safe extraction order (tests first)
- what must NOT be split (single transaction / state machine)

Priority targets usually include:
- apps/cli/src/app/PlaybackPhase.ts
- apps/cli/src/app-shell/workflows.ts
- apps/cli/src/app-shell/ink-shell.tsx

## 6. Deliverables

1. Findings table ordered by severity (correctness > perf > maintainability)
2. Duplicate clusters with merge/extract recommendation
3. Naming normalization phased plan (no big-bang renames)
4. Package boundary diagram (current vs target)
5. Top 5 safe fixes to implement first (with test plan)
6. Docs that must update if code moves

Constraints:
- bun run typecheck, lint, build, test for any code changes
- no provider behavior changes without tests
- no doc deletion without classification (Keep/Update/Merge/Archive/Prune)
- prefer shared abstractions over local patches
```

---

## How to use the output

1. **Naming** — normalize incrementally when touching a folder; do not mass-rename without import graph tooling.
2. **Duplicates** — extract only when two paths can diverge on correctness (TMDB clients, completion thresholds).
3. **Boundaries** — fix service→app imports before splitting god files (otherwise slices re-couple).
4. **Packages** — default answer is "stay in apps/cli" until a second consumer exists (daemon/web).

## Related artifacts

- `.plans/codebase-coherence-and-redundancy-report.md` — prior sweep
- `apps/cli/test/unit/architecture/boundary-imports.test.ts` — automated legacy import guard
