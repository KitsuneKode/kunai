---
"@kitsunekode/kunai": patch
---

feat(security): store tracker credentials in the OS credential vault

AniList/TMDB sync tokens and the Videasy session token now persist through a
credential-vault port: macOS Keychain, Windows Credential Manager, or Linux
Secret Service when reachable, with an owner-only file fallback on headless
machines. Existing `sync-tokens.json` and `config.json` values migrate on
first launch — write, read-back, compare, then delete — and every migration
step is restart-safe and idempotent (#179).
