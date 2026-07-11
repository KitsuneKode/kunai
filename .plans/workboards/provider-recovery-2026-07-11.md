# Provider Recovery Workboard — 2026-07-11

**Coordinator:** execution agent on `main`  
**Plan:** [.plans/provider-recovery-and-pr-triage-2026-07-11.md](../provider-recovery-and-pr-triage-2026-07-11.md)  
**Rule:** No remote PR closures, merges, rebases, or pushes from this pass. Staff review decides remote actions.

## User-owned unstaged (do not touch)

| Path                                       | Notes                                      |
| ------------------------------------------ | ------------------------------------------ |
| `.run.toml`                                | `bun run dev` alias tweak                  |
| `apps/cli/src/tmdb.ts`                     | TMDB proxy host comment/base migration WIP |
| `packages/providers/src/videasy/direct.ts` | `VIDEASY_DB_BASE` → `api.videasy.to/3` WIP |

## Adjacent unstaged WIP (leave unstaged; not in user list)

| Path                                              | Notes                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/providers/src/videasy/flavors.ts`       | Adds `listVidkingEndpoints()` seeding all flavors as curated-dead |
| `apps/cli/src/container/bootstrap-persistence.ts` | Switches seed import to `listVidkingEndpoints`                    |

These look like the same Videasy demotion investigation. Coordinator must not discard them; repair/demotion slices must either adopt with tests or leave alone.

---

## A. PR disposition (#5–#15)

Compared each tip against current `main` (merge-base `f6a5e1d7`; `main` is ~18 commits ahead). AD11 branches share a large CI/installer/test-flake base; do **not** merge the stack.

| PR  | Title                                                         | Disposition                                              | Reasoning                                                                                                                                                                                                                                | Selective owner / proof (if any)                                                                                                                                                                                         |
| --- | ------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #5  | Cursor Cloud AGENTS.md notes                                  | **close**                                                | Single optional docs hunk; optional cloud setup, not release-blocking; 4 failing checks.                                                                                                                                                 | —                                                                                                                                                                                                                        |
| #6  | Shell overlay state preservation                              | **selective candidate**                                  | Real UX bug (overlay unmounts browse/post-play). Idea is valid, but branch carries the full AD11 CI/Videasy base. Reimplement only `overlay-over-mounted` + input gate on current root-content ownership; do not copy stack.             | Owners: `root-content-shell.tsx`, `root-content-state.ts`, `RootContentInputGate.tsx`, `shell-screen-clear.ts`. Proof: `root-content-state.test.tsx` + render-capture at 72/100/140; pause calendar ticks under overlay. |
| #7  | Diagnostics panel/export trust                                | **selective candidate**                                  | Useful trust unification, but medium surface + shared AD11 base. Reimplement only shared bundle input + session-scoped merge if still missing on main.                                                                                   | Owners: `diagnostics-bundle-input.ts`, `DiagnosticsServiceImpl.ts`, `diagnostics-insight.ts`. Proof: `diagnostics-trust.test.ts` (absent on main).                                                                       |
| #8  | CI checkout + installer harden                                | **selective candidate**                                  | Still relevant: main workflows call local composite before checkout for several jobs while composite still nests `actions/checkout`. Installer empty-release harden may also be unique. Narrow CI-only reimplementation preferred.       | Owners: `.github/actions/setup-bun-monorepo/action.yml`, `.github/workflows/{ci,release,build-binaries}.yml`, `install.sh`, `install.ps1`. Proof: workflow syntax + installer unit/integration tests already on branch.  |
| #9  | Provider UI honesty                                           | **archive** (do not merge)                               | Touches tracks panel, source-quality, Miruro, direct-stream-source, Videasy, storage. Too broad for this recovery; overlaps provider drift work. Extract later only if a single mapper gap remains.                                      | —                                                                                                                                                                                                                        |
| #10 | Playback cache/fallback harden                                | **close**                                                | Large `PlaybackPhase` / resolve-service rewrite. Violates “no broad playback bundles”; current playback ownership on main is authority.                                                                                                  | —                                                                                                                                                                                                                        |
| #11 | Remaining reliability (Videasy preferred fallback + Esc docs) | **already superseded** (partial) / **archive remainder** | Preferred-fallback tests already exist on main; tip still differs in deprecated-endpoint cycle filtering. Videasy is under separate demotion research — do not land AD11 Videasy hunks during recovery. Esc-ownership docs are optional. | If staff wants the cycle filter later: `packages/providers/src/videasy/direct.ts` + `videasy-preferred-fallback.test.ts` only, after dossier disposition.                                                                |
| #12 | CI shared suite stabilization                                 | **already superseded** / **close as duplicate**          | Byte-identical product intent with #11 base; PR #15 text already marks duplicate of remaining-reliability. Suite flake fixes that remain useful should be cherry-picked as tiny test-only commits on main, not via this branch.          | —                                                                                                                                                                                                                        |
| #13 | Post-play footer keybind once                                 | **selective candidate**                                  | Small, well-tested idea (`ShellFrame` double-dispatch). Reimplement on current `shell-frame.tsx` without AD11 base.                                                                                                                      | Owners: `shell-frame.tsx`. Proof: `post-play-keybind-once.useinput.test.tsx` + existing `shell-frame-input-bridge.test.tsx`.                                                                                             |
| #14 | AD11 follow-up plan docs                                      | **archive**                                              | Plan-only PR. Keep as historical reference; do not treat as merge vehicle. Coordinator plan for this recovery supersedes execution sequencing.                                                                                           | —                                                                                                                                                                                                                        |
| #15 | AD11 integration stack                                        | **close**                                                | ~100 files / +4k lines bundling #6–#13 + follow-ups. Explicitly forbidden wholesale merge. Use as idea catalog only.                                                                                                                     | —                                                                                                                                                                                                                        |

### Coordinator follow-ups (not executed here)

1. Staff may close drafts #5, #10, #12, #14, #15 with the reasoning above (no remote action in this pass).
2. If staff wants one AD11 idea landed next: prefer **#13 keybind-once** or **#8 CI checkout** — each has current owners and deterministic proof.
3. Do **not** promote a release branch while Videasy/Miruro default lanes are knowingly unhealthy.

---

## B/C Research status

- Videasy dossier updated (2026-07-11): route-dead `sources-with-title` 404; TMDB proxy `/3` still alive.
- Miruro dossier updated (2026-07-11): reachable mirrors return pipe **403 HTML**; `.tv` TLS timeout; engine attempt timeout.

## D Disposition (providers) — decided

| Provider   | Lane    | Live class                | Final disposition                                                               |
| ---------- | ------- | ------------------------- | ------------------------------------------------------------------------------- |
| YouTube    | youtube | healthy                   | Keep enabled                                                                    |
| Rivestream | series  | healthy                   | Keep enabled; become series **default**                                         |
| AllAnime   | anime   | healthy                   | Keep enabled; remain anime default                                              |
| Videasy    | series  | provider drift            | **Demote from default** + quarantine all stream endpoints as curated route-dead |
| Miruro     | anime   | environment-network / WAF | **Demote from default** anime fallback; drop TLS-dead mirrors for fail-fast     |

## E Repair slices

1. Videasy: `listVidkingEndpoints` seed + default `provider` → `rivestream` + fixture tests.
2. Miruro: remove from `animeProviderPriority`; keep `bz`/`ru` only in pipe base list + fixture tests.
3. Do **not** commit user-owned `.run.toml` / `tmdb.ts` / `videasy/direct.ts` TMDB-base WIP.

## F Health automation

Landed: `.github/workflows/provider-matrix.yml` (manual/scheduled, non-blocking) + matrix `healthClass` + `KUNAI_MATRIX_ARTIFACT` redacted write.

## G Handoff

Ready for staff review.
