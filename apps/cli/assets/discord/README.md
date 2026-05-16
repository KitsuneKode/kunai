# Discord Rich Presence Assets

Source artwork for Discord Developer Portal image assets.

Upload these with exact asset keys:

- `kunai` from `kunai.svg`
- `subtitles` from `subtitles.svg`

Discord renders uploaded, portal-hosted assets by key. These files are not read at runtime; they
keep the source-of-truth artwork in the repo so the presence payload can rely on stable names.
