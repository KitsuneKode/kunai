---
"@kitsunekode/kunai": minor
---

Add the foundation for Kunai's local attention layer: shared media actions, recoverable queue sessions, local notification storage, follow/mute preferences, durable playlist storage, and safe playlist import/export helpers.

The new contracts keep notifications, queues, and playlist exports identity-based so raw stream URLs, provider headers, cookies, tokens, and local paths do not leak into shareable or long-lived user data.
