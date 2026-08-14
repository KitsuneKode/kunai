---
status: current
lastReviewed: "2026-05-04"
---

# Lint policy (beta)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

- **Gate:** `bun run lint` (oxlint) must exit **zero** in CI — **errors are blocking**; warnings may exist during beta burn-down.
- **Budget:** no per-warning budget file — fix new warnings in the same PR that introduces them; burn down existing warnings in focused batches when touching a file anyway.
- **Rationale:** keeps signal high for agents and humans without blocking unrelated refactors on legacy debt.
