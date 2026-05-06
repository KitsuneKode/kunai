---
"kunai-cli": minor
"@kunai/core": minor
"@kunai/providers": minor
"@kunai/storage": minor
"@kunai/types": minor
"@kunai/schemas": minor
---

# Kunai Beta 1 (Terminal-First UI Hardening)

- **UI Polish:** Persistent Ink TUI enforced minimal footer globally, training users on the `/` command bar.
- **Performance:** O(1) list virtualization and `useMemo` optimizations applied, eliminating frame drops during large episode list filtering.
- **History Revamp:** Netflix-style graphical progress bars `[██████░░░░]` added to History.
- **Smart Filtering:** Type `completed` or `watching` to narrow history rows.
- **Fallback UX:** Silent, graceful fallbacks with subtle toasts instead of blocking red error screens.
- **Architecture:** Complete transition to Turborepo workspaces (`@kunai/core`, `@kunai/storage`, `@kunai/providers`, etc.).