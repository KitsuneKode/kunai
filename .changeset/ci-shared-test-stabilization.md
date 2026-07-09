---
"@kitsunekode/kunai": patch
---

Stabilize shared CLI CI failures that only surfaced after checkout/installer CI started running again: durable diagnostics retention timestamp, install.ps1 dry-run without LOCALAPPDATA, and mock.module leak across app-shell unit tests. Gate live Miruro network checks behind KUNAI_LIVE_PROVIDERS.
