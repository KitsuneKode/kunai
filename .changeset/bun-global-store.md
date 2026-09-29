---
"@kitsunekode/kunai": patch
---

Worktree installs now share bun's global link store (`install.globalStore`),
so a fresh `.worktrees/` checkout stops re-materializing ~700 packages per
install. The docs app's Turbopack/tracing root widens to the common ancestor
of the repo and the store so symlinked packages still resolve.
