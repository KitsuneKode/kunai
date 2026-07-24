# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Kunai is **single-context**: one `CONTEXT.md` at the repo root, and one system-wide ADR set. There is no `CONTEXT-MAP.md` and no per-package `CONTEXT.md`, even though the repo is a bun workspace monorepo (`apps/*`, `packages/*`).

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary / ubiquitous language.
- **`.docs/adr/`** — read ADRs that touch the area you're about to work in. Note the leading dot: ADRs live in `.docs/adr/`, **not** `docs/adr/`.
- **`AGENTS.md` → `## Read This First`** — the repo's own routing table into `.docs/*`. `CONTEXT.md` is the vocabulary entry point, not the only one; architecture, runtime boundaries, providers, and UX each have a dedicated deep doc listed there. Follow the pointer relevant to your topic.

If `CONTEXT.md` doesn't exist yet, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms actually get resolved.

## File structure

```
/
├── CONTEXT.md                 ← glossary (created lazily)
├── AGENTS.md                  ← routing; CLAUDE.md is a symlink to it
├── .docs/
│   ├── adr/
│   │   └── 0001-personal-media-vocabulary.md
│   ├── architecture.md
│   ├── runtime-boundary-map.md
│   └── …                      ← see AGENTS.md § Read This First
├── apps/{cli,docs,relay-server,telemetry-ingest,experiments}
└── packages/{core,providers,storage,relay,schemas,types,config,design}
```

New ADRs go in `.docs/adr/` with the next sequential number.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

ADR 0001 (personal media vocabulary) is the live example: it pins the names for saved-for-later titles, durable collections, playback order, download jobs, release attention, and provider switching. Terms it retired — notably `playlist` for the runtime playback queue — must not come back.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (personal media vocabulary) — but worth reopening because…_
