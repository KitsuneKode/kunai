---
"@kunai/providers": patch
"@kunai/cli": patch
---

test(cli): pin the production provider roster and capability↔operation parity

The resolve-gate coverage class of bug — a registered production provider
silently absent from a hardcoded coverage list — now fails on main: the roster
is pinned to the 8 module ids `loadProductionProviderModules()` returns, and
every `capabilities` entry must have a runtime-port operation that implements
it. That check immediately caught two real drifts: youtube declared
`search`/`episode-list` capabilities its runtime ports never admitted, and
miruro declared `episode-list`/`subtitle-resolve` while listing only
`resolve-stream`. Both manifests now name the operations they actually run.
