# Playback And Recovery

Kunai keeps playback centered on one shell session. After `mpv` exits, you return to Kunai with context intact.

## Playback Flow

1. Search or continue a title.
2. Pick season, episode, source, quality, subtitles, or provider when needed.
3. Watch in `mpv`.
4. Return to Kunai for next episode, replay, provider fallback, diagnostics, history, or search.

## Resume And Continue

- `--continue` / `--resume` starts from the newest unfinished local history entry.
- `/history` lets you choose a previous title manually.
- Episode numbers shown in the UI are 1-based.
- Resume state is local and stored in Kunai history.

## Recovery Commands

- `r` reloads or recovers the current stream.
- `f` tries the next compatible provider.
- `/streams`, `/source`, and `/quality` expose stream/source/quality choices from already resolved inventory when available.
- `/diagnostics` shows recent provider, subtitle, cache, and playback events.
- `/export-diagnostics` writes a redacted support bundle.

Provider availability can drift. Recovery commands are part of normal usage, not a sign that the app is broken.

## Audio And Subtitles

- Preferred audio/subtitle language is configured in Settings or setup-related profiles.
- Kunai passes the preferred subtitle first when launching `mpv`.
- Additional subtitle tracks are attached when available, so you can switch inside mpv without another Kunai lookup.
- Source/quality/language-like provider variants are selected from already resolved stream inventory where possible to avoid extra network calls.

More detail lives in [`../../.docs/diagnostics-guide.md`](../../.docs/diagnostics-guide.md).
