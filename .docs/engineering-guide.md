# KitsuneSnipe — Engineering Guide

Use this doc when implementing or refactoring runtime architecture, shell flows, services, caching, scraping layers, or test seams.

This file exists to keep the codebase from drifting back into tightly coupled prompt chains, incidental shared state, and untestable provider logic.

## Engineering Principles

### One source of truth per concern

- `src/main.ts` should become the canonical runtime entrypoint
- shell state should live in explicit app or session state, not in scattered component-local assumptions
- provider registration stays centralized
- diagnostics, caching, and recovery policy should each have a clear owner
- when settings affect startup behavior, keep the persisted config, runtime bootstrap, and visible settings copy in sync in the same task

Avoid duplicating runtime orchestration in multiple entry paths.

### State machines over ad hoc flow

- shell flow should be event-driven and explicit
- overlays, loading states, setup blockers, and recovery actions should be modeled as state, not timing tricks
- if a flow is important enough to document, it is probably important enough to model explicitly

### Separate stable metadata from volatile runtime data

- title, season, episode, and poster metadata are long-lived
- stream URLs, signed manifests, and tokenized subtitle links are short-lived
- caching and invalidation must respect that difference

### Preserve composability

Refactors should make it easier to:

- add a provider
- change a recovery policy
- add a shell overlay
- swap an image backend
- test a resolver or metadata layer in isolation

If a change makes one of those harder, stop and look for a better seam.

## Recommended Layering

### Shell layer

Owns:

- layout
- focus
- overlays
- command routing
- user-facing state presentation

Should not own:

- provider-specific scraping rules
- direct media resolution logic
- cross-cutting persistence rules

### Application and orchestration layer

Owns:

- app state transitions
- command dispatch
- policy decisions
- handoff between metadata, scraping, playback, and persistence

### Provider and scraping layer

Owns:

- site-specific behavior
- network and DOM extraction
- candidate stream inventory
- subtitle / dub / quality discovery

Should not own:

- shell UI policy
- global command semantics
- unrelated app flow logic

### Persistence and diagnostics layer

Owns:

- config
- history
- cache stores
- in-memory diagnostics event buffers
- local reports
- privacy-safe trace buffers

## Service Boundaries To Prefer

When shaping new code, prefer services or modules that can be reasoned about independently:

- `command-router`
- `capability-service`
- `catalog-store`
- `provider-resolution-service`
- `recovery-policy-service`
- `setup-guardrail-service`
- `diagnostics-store`
- `image-preview-service`

These names do not have to be exact, but the responsibilities should stay cleanly separated.

## Skill Routing For Implementation

Use these repo-local defaults when working in this codebase:

| Situation                                     | Preferred skill(s)                               | Why                                                                        |
| --------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Shell flow, overlays, hotkeys, responsiveness | `make-interfaces-feel-better`, `emil-design-eng` | Keep the TUI polished and intentional instead of merely functional         |
| Large shell or layout changes                 | `frontend-design`                                | Useful when shaping a full-screen composition or stronger visual direction |
| React or Ink component refactors              | `vercel-react-best-practices`                    | Helps keep component boundaries and state usage disciplined                |
| Official library behavior or API lookup       | `context7-mcp` or official docs                  | Prefer primary documentation when touching library-specific behavior       |
| Provider research workflow creation           | `skill-creator`                                  | Useful when shaping repeatable agent workflows or instructions             |

Notes:

- Ink is not DOM React, but React component discipline still applies
- use official Ink documentation as the source of truth when changing Ink-specific lifecycle or input behavior
- apply design skills to interaction rhythm and state clarity, not decoration-first theatrics

## Performance Principles For A TUI

- the primary list and input flow always win over secondary panes
- do not block navigation for images or expensive metadata work
- debounce expensive preview work, not immediate selection feedback
- treat resize and tiling as first-class runtime conditions
- degrade gracefully before throwing a "too small" blocker
- window large lists instead of rendering everything
- cancel or supersede stale async work aggressively

## Refactoring Rules

- prefer extracting shared abstractions over copying fixes into multiple files
- if legacy flow and refactored flow diverge, document the migration target immediately
- if a module becomes responsible for UI, provider logic, caching, and diagnostics at once, it is too broad
- do not let `src/` become a dumping ground for every test type; keep integration, live, and VHS assets under `test/`
- keep data models and UI models distinct where possible

## Drift Watchlist

If one of these starts appearing again, treat it as design debt immediately:

- two runtime entry stories with different behavior
- two cache paths storing the same concept in different shapes
- provider-specific conditionals leaking into shell components
- playback, setup, and diagnostics each inventing their own command handling
- picker cancel paths that silently mutate state or start playback
- settings that change runtime defaults without updating visible labels and bootstrap behavior
- new UI flows that cannot be expressed in tests or VHS tapes without heroic mocking

## Documentation Rules

When the implementation changes a meaningful contract, update the appropriate durable doc:

- shell behavior: `.docs/ux-architecture.md`
- runtime structure: `.docs/architecture-v2.md`
- provider research or contract: `.docs/providers.md` and provider dossier docs
- major roadmap implications: the relevant `.plans/*.md`

Do not let chat become the only place where important implementation rules exist.

## Comment Rules

- add comments only when control flow, migration seams, or provider behavior would otherwise be easy to misread
- comments should explain why the path exists, not restate the code mechanically
- if a comment starts competing with `.docs/` or `.plans/` as a second spec, shrink or remove it
- when migration work changes the meaning of a comment, update or delete it in the same task
