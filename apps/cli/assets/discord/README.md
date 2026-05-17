# Discord Rich Presence Assets

Source artwork for Discord Developer Portal image assets.

Upload these with exact asset keys:

- `kunai` from `kunai.svg`
- `subtitles` from `subtitles.svg`

Discord renders uploaded, portal-hosted assets by key. These files are not read at runtime; they
keep the source-of-truth artwork in the repo so the presence payload can rely on stable names.

Manual smoke checklist:

- upload both assets to the Discord Developer Portal for the application id under test
- run `KUNAI_LIVE_DISCORD_PRESENCE=1 bun run test:live:discord`
- start playback with full privacy enabled and confirm the activity card uses the uploaded artwork
- keep this manual and opt-in; default tests must not depend on live Discord IPC
