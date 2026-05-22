# Sakura Redesign — Rollout Plan

Status: **in progress** — foundation landed (tokens + theme contract). Slices below are parallelizable across agents.

Goal: ship the Sakura design system (dusk plum · rose · mint) as the next Kunai version, then keep it future-proof. Source code is truth; the design contract is [.docs/design-system.md](../.docs/design-system.md); visual reference is [`.design/cli/kunai-sakura*.html`](../.design/cli/).

## Guiding rules (apply to every slice)

- **THE ONE RULE**: color = state or focus, never identity. Titles win by weight. Media-type hue only on Stats.
- Prefer semantic palette names (`accent`, `ok`, `danger`, `line`, `muted`…). Replace deprecated color-names; never add new uses of them.
- Each surface owns loading / success / empty / error states.
- Preview rail reserves poster slot; metadata never jumps. Hide image before text.
- Footer ≤ 4 primary actions + `[/] commands`.
- Verify every slice: `bun run typecheck && bun run lint && bun run test`. Add/adjust view-model or theme tests when behavior changes.

## Sequencing

```
S0 Foundation (done) ──► S1 Consumer migration ──► S2 Failure/recovery ──► RELEASE v(next)
                     └─► (parallel) S3 Portability  S4 Unmocked surfaces  S5 Return loop
```

S2 and the S1 playback/browse slices gate the release. S3–S5 can land before or shortly after; none should block the version that flips the look.

---

## S0 · Foundation — DONE

- `packages/design/src/tokens.ts`: honest Sakura semantic tokens + deprecated color aliases.
- `apps/cli/src/app-shell/shell-theme.ts`: semantic `palette`, `statusColor`/`contentTintColor`/`heatColor` repointed.
- `.docs/design-system.md`: rewritten to the Sakura contract.
- Theme + selectable-row tests rebound to palette (no pinned legacy hex). typecheck/lint/test green.

Outcome: the whole shell already renders in Sakura via aliases. Remaining work is correctness + completeness, not "turn it on".

## S1 · Consumer migration (deprecated → semantic)

Replace deprecated color-name call sites with semantic names, fixing meaning while doing so (e.g. a `teal` cursor → `accent`; a `teal` info label → `muted`). 28 files reference `palette`. Split by surface family so two agents don't touch the same file.

- **Agent A — playback family**: `post-play-shell.tsx`, `loading-shell.tsx`, `ink-shell.tsx`, now-playing, tracks. Map `amber→accent`, `green→ok`, `teal` per meaning.
- **Agent B — discovery/pickers**: `root-overlay-*`, `picker-overlay.tsx`, `pickers/*`, search results, recommendations, calendar.
- **Agent C — memory surfaces**: history, `Heatmap.tsx`, stats (keep `contentTintColor` for type hue), library/downloads, `download-manager-shell.tsx`.

Done when no `palette.{amber,pink,teal,cyan,info,lavender,green,red,yellow,gray,*Fill,border*}` remains outside the deprecation block; then delete the aliases from `tokens.ts` + `shell-theme.ts`.

## S2 · Failure & recovery surfaces (release gate)

The real product for a scraper app. Draw + implement, using `danger` + glyph + one recovery action:

- `Playback did not start` (never marks watched, never offers next as primary).
- `Stream stalled` (promote recover/fallback into body+footer while relevant).
- `No source available` / `Quality variants unavailable`.
- `Provider degraded · falling back` (quiet inline state).
- **Diagnostics** surface (referenced across specs, never drawn): evidence/trace behind a command, never centered in normal flow.

## S3 · Portability (parallel)

Implement the degradation order in [.docs/design-system.md](../.docs/design-system.md):

- Color resolution layer: truecolor hex → 256 → 16. Centralize in `packages/design` so tokens stay single-source.
- Poster: image → letter tile → hidden; stable reserved slot.
- Responsive: preview rail collapses before list; narrow/SSH/tmux keeps brand·mode·status + list + `[/]`.
- CJK/long-title truncation + double-width column alignment.

## S4 · Unmocked daily surfaces (parallel)

Bring to Sakura parity (prototypes exist for most; these three do not):

- **Search results** — query vs result-filter state separation, list + preview rail. Most-used surface; highest priority of the three.
- **Tracks panel** — capability sections, single-option rows render as facts (no dead pickers).
- **Command palette** — scoped (PPS / subpanel / global); never a portal to the whole app.

## S5 · Return loop (parallel, cross-surface)

Not a screen — wire the habit loop the product depends on:

- Browse leads with **"ready for you now"** (tracked shows whose new episode dropped).
- Calendar surfaces the same releases; History shows the resume; presence broadcasts it.
- Streak reinforcement that is motivating, never guilt copy.

## Doc cleanup (fold in as slices land)

- `.docs/design-system.md` previously listed `apps/cli/src/design.ts` (does not exist); already dropped in the rewrite.
- Update [.plans/plan-implementation-truth.md](plan-implementation-truth.md) and [.plans/kitsune-design-system-and-recommendations.md](kitsune-design-system-and-recommendations.md) to point at this rollout and the Sakura contract.
- When aliases are deleted (end of S1), remove the deprecation sections from `tokens.ts` and `shell-theme.ts`.

## Release gate (the next version)

Ship when: S0 done · S1 playback+browse migrated · S2 failure/recovery shipped · typecheck/lint/test green · `bun run build` clean · a manual pass on a non-Kitty / narrow terminal shows no broken layout. S3–S5 land around the release, then iterate.

## Acceptance checks (per surface)

Header follows the shell contract · footer ≤ 4 + commands · loading/success/empty/error present · preview rail reserves poster and hides before text · no dead picker for one-option sections · palette is semantic (no deprecated names) · type hue only on Stats · failure states use `danger` + glyph + recovery action.
