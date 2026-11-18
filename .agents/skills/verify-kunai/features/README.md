# Feature map

One file per user-facing journey, from the user's point of view. Each says
what the feature is, how a user reaches it, the exact `agent:drive` key plan
that proves it (happy path and the way back out), and what has bitten drives
before. Every plan here was run against fixture providers with the network
guard on; a plan that stops matching the app is drift, and fixing it is part
of the change that moved the app.

Run every drive from `apps/cli`. The fixture catalog answers `smoke` with
`Smoke Movie`, `Smoke Series`, `Smoke Anime` and friends; other queries return
nothing.

| Feature                | File                       | Proves                                                |
| ---------------------- | -------------------------- | ----------------------------------------------------- |
| Search                 | [search.md](search.md)     | query → results → empty state                         |
| Playback and post-play | [playback.md](playback.md) | select → resolve → fake mpv → post-play → history row |
| Up Next                | [up-next.md](up-next.md)   | queue from results → see it → remove it               |
| Release schedule       | [schedule.md](schedule.md) | open, offline failure, return to Browse               |
| Settings               | [settings.md](settings.md) | toggle → committed `config.json`                      |

Not mapped yet: onboarding (L3 only — the wizard needs a real TTY), downloads
and offline library, history, notifications, details overlay. Add a file when
you verify one of them; do not invent a plan you have not run.
