---
"@kitsunekode/kunai": minor
---

Add the foundation for Kunai's local attention layer: shared media actions, recoverable queue sessions, local notification storage, follow/mute preferences, durable playlist storage, and safe playlist import/export helpers.

The notification inbox now has explicit action rows, history and browse rows can be queued without replacing playback, post-playback recommendation picks can be queued with number keys and an explicit details/download action panel, `/playlist` can import/export safe playlist JSON, and the experimental provider availability worker is wired as a cancellable no-network-by-default planning scaffold.

The new contracts keep notifications, queues, and playlist exports identity-based so raw stream URLs, provider headers, cookies, tokens, and local paths do not leak into shareable or long-lived user data.
