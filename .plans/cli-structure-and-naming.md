# CLI Structure And Naming Plan

Status: planned

This plan captures a structural and naming cleanup for `apps/cli/src` and the
package boundaries around it. It was produced from a full structural review of
`apps/cli/src` and `packages/*`, cross-referenced against two external reference
codebases (`claude-code-leaked-source` for CLI/TUI module patterns, `t3code`
for domain-folder + `Services`/`Layers` + `.logic.ts` patterns) and the existing
[runtime-boundary-map.md](../.docs/runtime-boundary-map.md).

## Goal

Make the CLI codebase easier to navigate, reason about, and extend by:

- Locking one filename convention per role and enforcing it.
- Sub-grouping the flat `app/` folder by feature.
- Breaking the largest god files into tested, single-responsibility modules.
- Finishing the planned package extractions (`@kunai/config`, `@kunai/ui-cli`).
- Removing legacy root files and tightening boundary enforcement.

This is a long-lived cleanup. Do it tier by tier; do not attempt it in one pass.

## Non-Negotiables

- Follow the [rename policy](../.docs/runtime-boundary-map.md): rename/move a file
  only when (1) the destination boundary is clear, (2) tests cover the old
  behavior, (3) imports update mechanically, (4) the commit changes no unrelated
  behavior.
- No structural commit may change runtime behavior. Moves and renames only.
- Boundary direction must never regress: `types → schemas/core → providers/relay
→ storage → apps`. The existing `boundary-imports.test.ts` must stay green.
- Do not mass-rename for style in one commit. Rename within a folder/feature
  slice at a time so review and `git` history stay legible.

## Locked Decisions

- **Filename casing:** kebab-case for all `.ts` files (services, phases, engines,
  policies, helpers). PascalCase is reserved exclusively for `.tsx` React/Ink
  component files whose default export is the component. This matches
  `packages/*` (already all kebab-case) and the non-component files in both
  reference repos.
- **Class export names stay PascalCase** even when the file is kebab-case
  (e.g. `download-service.ts` exporting `class DownloadService`). Only the
  filename changes.

## Convention Reference (target)

| Role                        | Filename                                      | Layer                                   |
| --------------------------- | --------------------------------------------- | --------------------------------------- |
| Ink component               | `PascalCase.tsx`                              | `app-shell` (or future `@kunai/ui-cli`) |
| Screen surface              | `*-shell.tsx`                                 | `app-shell`                             |
| Pure view model             | `*-view.ts`                                   | `app-shell` or `domain`                 |
| Component-local logic       | `*-view.ts` / dedicated `*.logic.ts` sibling  | `app-shell`                             |
| Pure/session policy         | `*-policy.ts`                                 | `domain` (pure) / `app` (session)       |
| Action→route mapping        | `*-routing.ts`                                | `app` / `domain`                        |
| Service (I/O orchestration) | `*-service.ts` + optional `*-service-impl.ts` | `services`                              |
| Storage abstraction         | `*-repository.ts`                             | `packages/storage`                      |
| Boundary translation        | `*-adapter.ts`                                | consuming boundary                      |
| Runtime start/stop ordering | `*-lifecycle.ts`                              | `app` (policy) / `infra` (mechanics)    |

Avoid `manager`, `controller`, `helper` for new files unless the file truly owns
stateful coordination.

## Tier 1: Decide And Enforce Conventions

Low risk. Establishes the rules before any large move so new code stops drifting.

- Update [runtime-boundary-map.md](../.docs/runtime-boundary-map.md) "Naming And
  Placement Rules" to state the locked kebab-case decision explicitly.
- Add a unit test (extend
  `apps/cli/test/unit/architecture/`) that asserts filename conventions:
  - No PascalCase `.ts` files under `apps/cli/src` except an allowlist of files
    not yet migrated (shrink the allowlist over time).
  - `.tsx` files are PascalCase or end in `-shell.tsx`/`-ui.tsx`.
- Add a boundary-test rule forbidding **new** files at `apps/cli/src/` root other
  than `main.ts`, `container.ts`, `cli-args.ts`, `asset-modules.d.ts`.

## Tier 2: Sub-group The Flat Folders

Mechanical file moves + import updates. Highest navigation payoff.

- Give `app/` feature subfolders and move files in (no behavior change):
  - `app/session/` — `session-controller`, `phase`, `mode-switch`, `session-overrides`
  - `app/playback/` — `playback-phase` + the ~25 `playback-*` policy slices
  - `app/search/` — `search-phase`, `search-selection-routing`, `browse-option-mappers`
  - `app/discover/` — `discover-*`, `discovery-lists`, `random-results`, `calendar-results`
  - `app/post-play/` — `post-play-*`, `autoplay-advance-countdown`
  - `app/bootstrap/` — `bootstrap-intent`, `launch-entry`, `apply-settings-to-runtime`
  - `app/offline/` — `offline-playback*`, `episode-playback-source`
- For `services/` and `infra/`: make the **interface + impl split the default for
  new work** (`*-service.ts` contract + `*-service-impl.ts`). Do not convert all
  existing concrete services at once; convert when a service is otherwise touched.
- Move the `*Service.ts` files that live in `domain/` (`ListService`,
  `StatsService`, `QueueService`) to the correct layer: pure rules stay in
  `domain/` (renamed kebab-case, no `Service` suffix); any I/O moves to
  `services/`.

## Tier 3: Break The God Files

Higher risk. Extract tested slices incrementally; never rewrite wholesale.

- `app/playback/playback-phase.ts` (~4,280 lines): extract tested transition
  slices into `app/playback/*-policy.ts`. Target end state: the phase coordinates
  and the policy modules decide.
- `app-shell/workflows.ts` (~2,473 lines): split into feature workflow files
  (`history-workflows.ts`, `picker-workflows.ts`, `setup-workflows.ts` already
  exist as the target pattern). Retire the bucket file.
- Adopt the `*-view.ts` extraction for the big shells:
  `browse-shell.tsx` (~1,761), `root-overlay-shell.tsx` (~1,884),
  `ink-shell.tsx` (~2,293). Pull pure data shaping into `*-view.ts`; leave
  rendering in `.tsx`.
- Rename `app-shell/panel-data.ts` (~1,380) to follow the `*-view.ts` rule
  (it is already mostly a view-model builder).

## Tier 4: Package Extraction

Do each only when the seam is clean and adapter tests exist.

- Extract `@kunai/config` from `services/persistence/config-service*`. Most-ready
  extraction; config shapes already partly in `@kunai/schemas`.
- Extract `@kunai/ui-cli` from `app-shell/primitives/` (+ design-token
  consumption). Enables future web/desktop surfaces per
  [architecture-v2.md](../.docs/architecture-v2.md).
- Move provider failure-classification behavior out of `@kunai/types` into
  `@kunai/core` so the types package stays contracts-only.

## Tier 5: Tighten Boundaries

- Forbid `app-shell → @kunai/storage` direct imports in `boundary-imports.test.ts`;
  route storage read-models through `services`.
- Add `@kunai/relay` to `ALLOWED_WORKSPACE_DEPS_BY_PACKAGE` in the workspace-dep
  test for completeness.
- Consider validating `apps/cli` workspace deps (currently in `devDependencies`,
  so unchecked).

## Tier 6: Legacy Cleanup

- Relocate active root legacy files to their boundary homes or quarantine if dead:
  - `mpv.ts` → `infra/player/`
  - `logger.ts` → `infra/logger/`
  - `search.ts`, `tmdb.ts` → `services/catalog/` or `services/search/`
  - `session-flow.ts`, `subtitle.ts`, `aniskip.ts`, `introdb.ts`, `menu.ts`,
    `ui.ts` → nearest owning boundary
- Borrow the two-tier entry pattern: keep `main.ts` thin (arg parse + fast paths)
  and dynamic-import heavy bootstrap into `bootstrap/`.
- Consider splitting `container.ts` (~836 lines) into per-domain registrar
  modules wired by a small root container.

## Sequencing

1. Tier 1 first (rules + enforcement) so drift stops.
2. Tier 2 next (cheap, high navigation payoff).
3. Tiers 3–6 opportunistically, slice by slice, when touching the relevant area.

## Related Docs

- [runtime-boundary-map.md](../.docs/runtime-boundary-map.md)
- [architecture-v2.md](../.docs/architecture-v2.md)
- [engineering-guide.md](../.docs/engineering-guide.md)
- [turborepo-and-package-boundaries.md](./turborepo-and-package-boundaries.md)
