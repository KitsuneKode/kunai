# YouTube Provider Plan

Status: Idea

Use this only when researching or implementing a YouTube-backed provider.

## Goal

Add YouTube as a search and playback source without requiring the YouTube API.

## Likely Shape

- search via Invidious
- resolve playable URLs via `yt-dlp`
- hand the resulting URL to `mpv`

## Draft Provider Shape

```ts
export const YouTubeProvider: ApiProvider = {
  kind: "api",
  id: "youtube",
  description: "YouTube via yt-dlp",

  async search(query) {
    // Invidious-backed search
  },

  async resolveStream(id) {
    // yt-dlp --get-url https://youtube.com/watch?v={id}
  },
};
```

## Research Inputs

- reference repo: `/home/kitsunekode/Projects/osc/ytfzf`
- binary dependency: `yt-dlp`
- fallback search source: public Invidious instances

## Open Questions

1. Which Invidious instances are stable enough to trust by default?
2. Which `yt-dlp` flags best match `mpv` playback needs?
3. Should YouTube be a separate search mode or share the existing picker flow?
4. How should age-restricted or unavailable videos degrade?

## Not Started Because

The provider system is ready for it, but the repo does not yet have enough research to lock down a clean implementation contract.
