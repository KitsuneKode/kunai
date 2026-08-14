---
status: current
lastReviewed: "2026-07-29"
---

# Domain Docs

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Kunai is **single-context**: one glossary, and one system-wide ADR set. There is no `CONTEXT-MAP.md` and no per-package context file, even though the repo is a bun workspace monorepo (`apps/*`, `packages/*`).

## Before exploring, read these

- **`.docs/glossary.md`** — the glossary / ubiquitous language. Trap-first: a term is listed because confusing it has caused a bug, and every entry cites the code that settles it.
- **`.docs/adr/`** — read ADRs that touch the area you're about to work in. Note the leading dot: ADRs live in `.docs/adr/`, **not** `docs/adr/`.
- **`AGENTS.md` → `## Deep docs`** — the repo's own routing table into `.docs/*`. The glossary is the vocabulary entry point, not the only one; architecture, runtime boundaries, providers, and UX each have a dedicated deep doc listed there. Follow the pointer relevant to your topic.

## File structure

```
/
├── AGENTS.md                  ← routing; CLAUDE.md is a symlink to it
├── .docs/
│   ├── glossary.md            ← ubiquitous language
│   ├── adr/
│   │   └── 0001-personal-media-vocabulary.md
│   ├── architecture.md
│   ├── runtime-boundary-map.md
│   └── …                      ← see AGENTS.md § Deep docs
├── apps/{cli,docs,relay-server,telemetry-ingest,experiments}
└── packages/{core,providers,storage,relay,schemas,types,config,design}
```

New ADRs go in `.docs/adr/` with the next sequential number.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `.docs/glossary.md`. Don't drift to synonyms the glossary explicitly avoids.

ADR 0001 (personal media vocabulary) is the live example: it pins the names for saved-for-later titles, durable collections, playback order, download jobs, release attention, and provider switching. Terms it retired — notably `playlist` for the runtime playback queue — must not come back.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (personal media vocabulary) — but worth reopening because…_
