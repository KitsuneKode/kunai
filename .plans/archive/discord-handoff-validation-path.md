# Discord Handoff Validation Path

Status: active manual validation path

This tracks the remaining reliability work around Discord activity handoffs after the local
`kunai://` parser, confirmation screen, settings row, and Linux protocol registration helper were
implemented.

## What Is Implemented

- `presenceDiscordOpenUrl` is configurable from `/presence` and `/settings`.
- Discord presence accepts only safe `https://` and `kunai://` button URLs.
- `kunai --handoff-url` accepts only playback/download handoff intents and asks locally before
  taking action.
- `kunai --install-protocol-handler --dry-run` prints the planned Linux XDG desktop entry and
  `xdg-mime` command.
- `kunai --install-protocol-handler` installs the Linux source/global handler.
- Default tests and CI stay deterministic; live Discord checks remain opt-in.

## Manual Validation

1. Upload Discord Developer Portal image assets with keys `kunai` and `subtitles`.
2. Start Discord desktop.
3. Open Kunai settings with `/presence`.
4. Set Presence to Discord and choose the desired privacy mode.
5. Set Discord open URL to a safe handoff such as `kunai://play?search=Dune`.
6. Inspect protocol registration with `kunai --install-protocol-handler --dry-run`.
7. Register locally with `kunai --install-protocol-handler`.
8. Run `KUNAI_LIVE_DISCORD_PRESENCE=1 bun run test:live:discord`.
9. Start a real playback session and confirm Discord shows progress/media facts and uploaded
   artwork.
10. Click `Open in Kunai` and confirm the local confirmation screen appears before playback or
    download starts.

## Remaining Product Work

- Move Linux protocol registration into the packaged installer.
- Add macOS and Windows protocol registration through packaged installers rather than ad hoc source
  commands.
- Decide whether a public HTTPS relay is useful for users who cannot or should not register local
  protocol handlers.
- Keep provider URLs, stream URLs, subtitle URLs, request headers, local paths, and diagnostics out
  of all activity text/buttons/assets.
