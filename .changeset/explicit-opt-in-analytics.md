---
"@kitsunekode/kunai": patch
---

Make anonymous usage analytics explicit opt-in. Setup now defaults to off, Settings can enable or disable collection, and disabling removes the local install identifier.

### Privacy

- Do not send analytics before consent, without an interactive terminal, or when DNT or CI blocks it.
- Leave the production endpoint disabled until an operator configures and verifies one.
