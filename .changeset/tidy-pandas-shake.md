---
"@kitsunekode/kunai": patch
---

Fix a set of silent failures found while auditing the tree.

- Quitting immediately after changing a setting could lose the change: a debounced save that had already started was not awaited by the shutdown flush.
- A single offline blip or navigating away mid-load could leave trending empty for 30 minutes, because a failed discovery fetch was cached as "no results".
- "Keep the last N watched" retained nothing for absolute-numbered anime, and the same numbering mismatch stopped watched anime downloads from ever being reclaimed and stopped the resume position being restored after a crash.
- Analytics now refuses a non-https endpoint override instead of sending in cleartext. A rejected override stops sending entirely rather than falling back to the built-in URL.
- A self-hosted relay behind a sub-path (`https://host/prod`) is now called correctly instead of 404ing and silently falling back to direct.
- Long CJK and emoji titles could still produce a Windows path over `MAX_PATH`; the path is now measured and tightened rather than estimated.
- An intro-skip window from AniSkip is no longer discarded when IntroDB answers with an untimed segment.
- A config file that is unreadable, or that vanishes mid-read, no longer throws or overwrites its own corrupt-backup with an empty file.
