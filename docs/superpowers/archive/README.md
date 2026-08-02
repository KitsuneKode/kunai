# `docs/superpowers/archive/` — landed SDD plans and specs

Spec-driven-development artifacts whose work shipped. Each pair is one feature:
a `specs/<date>-<name>-design.md` describing the decision, and a
`plans/<date>-<name>.md` describing the tasks that implemented it.

**Do not execute a plan from this folder.** Its task list was written against a
tree that has since moved, and SDD plans never check their own boxes — an
unchecked `- [ ]` here means nothing. Status lived in the run, not the file.

## What stayed live

Only the **resolve-loop wave** remains in `../plans/` and `../specs/`, indexed by
[`../plans/2026-07-28-execution-board.md`](../plans/2026-07-28-execution-board.md).
Start there, not at an individual plan.

## Reading these

They are worth keeping for one reason: several record _deviations_ — where the
executor found the plan was wrong and did something else. Those notes explain
why the code does not match the plan it came from. Grep for "deviation" when the
current implementation surprises you.

Three source comments cite plans in here by path
(`videasy/direct.ts`, `kunai-mpv-bridge.ts`, `playback-postplay-policy.ts`).
Keep those paths working if you reorganize this folder again.

## Rule

A pair moves here when its wave closes. If you find work in an archived plan
that looks unfinished, verify it against the code first, then put one line on
[`../../../.plans/roadmap.md`](../../../.plans/roadmap.md) — do not revive the
file.

Nothing under `docs/superpowers/` is published: the docs site only builds
`index.mdx`, `users/**`, and `developer/**` (see `apps/docs/source.config.ts`).
