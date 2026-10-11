---
"@kitsunekode/kunai": patch
---

Remove the manifest `status` field (`production`/`candidate`) — it was a
display-only label that gated nothing; registration in
`loadProductionProviderModules()` is the real state. Providers no longer render
a `· candidate` suffix in the picker or Tracks panel. The provider-status page
now groups the daily sweep into Working / Limited / Down, with the raw sweep
verdict kept as a detail tag and per-provider limitations in the note column.
