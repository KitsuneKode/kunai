# Tracks Panel

Tracks is one unified scoped panel.

Commands `/tracks`, `/source`, and `/quality` open the same surface. `/source` and `/quality` deep-link focus into their sections.

## Purpose

Help the user understand or change stream setup without opening many generic one-row pickers.

## Sections

- Source
- Quality
- Audio
- Subtitles
- Hardsub

## Row Rules

- Rows with real alternatives are selectable.
- Single-option sections render as facts.
- Unavailable sections explain why.
- Failed candidates may appear only if the reason helps recovery.

Examples:

```text
Source
> VID MP4        current · direct-http · cache hit
  Fallback host  available · lower confidence
  Mirror 3       failed last attempt

Quality
  Best available provider did not expose variants

Subtitles
  English        attached in mpv · 151 tracks available
  Select in mpv  switching belongs to mpv when all tracks are attached
```

## Subtitle Policy

Subtitles are informational by default because Kunai attaches tracks to mpv.

Only make subtitles selectable in Kunai if the backend exposes a true pre-play subtitle choice that affects stream resolution.

## Backend Contract

UI should render normalized capabilities, not raw provider fragments:

```ts
type TrackCapabilitySection = "source" | "quality" | "audio" | "subtitle" | "hardsub";

type TrackCapability = {
  section: TrackCapabilitySection;
  label: string;
  value: string;
  selected: boolean;
  enabled: boolean;
  reason?: string;
  detail?: string;
  risk?: "normal" | "fallback" | "failed" | "unavailable";
};
```

## Footer

```text
[↑↓] select   [enter] change   [r] refresh   [esc] back   [/] commands
```

If no rows can change, `enter` should not open a dead picker.
