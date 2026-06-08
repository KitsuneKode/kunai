# Discord Rich Presence Assets

Source artwork for Discord Developer Portal image assets.

Upload these with exact asset keys:

- `kunai` from `kunai.png`
- `subtitles` from `subtitles.svg` (export to PNG at 1024×1024 before upload if needed)

`kunai.svg` is the source artwork; `kunai.png` is the portal-ready export. Both use the sakura
pixel mascot from `.design/brand/kunai-readme-hero.svg` on the `#100b0f` terminal background.

Discord Rich Presence art asset requirements:

- **Dimensions:** 1024×1024 (1:1)
- **File types:** PNG, GIF, JPG, WEBP
- **Max size:** 10 MB

Regenerate `kunai.png` from the SVG:

```sh
rsvg-convert -w 1024 -h 1024 apps/cli/assets/discord/kunai.svg -o apps/cli/assets/discord/kunai.png
```

Discord renders uploaded, portal-hosted assets by key. These files are not read at runtime; they
keep the source-of-truth artwork in the repo so the presence payload can rely on stable names.

Manual smoke checklist:

- upload both assets to the Discord Developer Portal for the application id under test
- run `KUNAI_LIVE_DISCORD_PRESENCE=1 bun run test:live:discord`
- start playback with full privacy enabled and confirm the activity card uses the uploaded artwork
- keep this manual and opt-in; default tests must not depend on live Discord IPC
