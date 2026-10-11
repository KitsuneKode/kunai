---
"@kitsunekode/kunai": patch
---

Add `providerDefaultsRevision` so future default changes reach existing users.

Every setting save writes the whole merged config, which means the shipped anime
provider default is baked into `config.json` for anyone who has ever launched —
indistinguishable from a deliberate choice. A revision stamp is now written on
load, and `ConfigServiceImpl` migrates a config whose anime pair is exactly what
a release once shipped (`anidb`/`["anidb"]`, `["anidb", "allanime"]`, or a
config older than the priority key) to the current defaults, once. Any other
pair is left alone, and picking a provider afterwards sticks.

This changes nothing user-visible yet — it is the mechanism a future
default-provider change uses instead of stranding existing installs.
