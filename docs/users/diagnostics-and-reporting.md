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
- subtitle evidence
- playback and mpv runtime events
- cache and stream health events
- update checks and failures

## Privacy

Diagnostics should redact stream URLs, sensitive headers, and local home paths before export. Review exported files before sharing them publicly.

More detail lives in [`../../.docs/diagnostics-guide.md`](../../.docs/diagnostics-guide.md).
