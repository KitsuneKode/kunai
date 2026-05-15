# Diagnostics And Reporting

Diagnostics are local-first. Kunai records enough context to explain failures without automatically uploading anything.

## Useful Commands

- `/diagnostics` opens the runtime diagnostics panel.
- `/export-diagnostics` writes a redacted JSON support bundle near the current working directory.
- `/report-issue` opens issue reporting guidance.
- `--debug` enables more verbose startup and runtime logging.

## What Diagnostics Cover

- startup capabilities such as `mpv`, `yt-dlp`, `ffprobe`, and poster renderer support
- provider resolve stages and failures
- provider fallback timelines, including which provider failed and which fallback recovered
- subtitle evidence
- playback and mpv runtime events
- cache and stream health events
- update checks and failures

## Good Smoke Tests

From a source checkout:

```sh
bun run dev -- -S "Dune"
bun run dev -- -S "Attack on Titan" -a
bun run dev -- -S "Dune" --debug
bun run dev -- --discover
bun run dev -- --random
bun run dev -- --calendar
bun run dev -- --offline
bun run dev -- --zen --offline
```

If a provider takes time but is still retrying, Kunai should describe it as retry/fallback progress,
not as a final error. Use `/diagnostics` or `/export-diagnostics` to inspect the attempt timeline.

## Privacy

Diagnostics should redact stream URLs, sensitive headers, and local home paths before export. Review exported files before sharing them publicly.

More detail lives in [`../../.docs/diagnostics-guide.md`](../../.docs/diagnostics-guide.md).
