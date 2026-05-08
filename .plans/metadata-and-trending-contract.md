# Kunai Metadata & Trending Contract 🥷✨

This document defines the deterministic rules for how Kunai fetches, displays, and maps metadata (trending lists, release dates, sub/dub tags).

**The Golden Rule:** The scraping providers (Vidking, Miruro, Anikai) are completely untrusted for metadata. They are only used to fetch video URLs. All metadata is sourced exclusively from official APIs (AniList and TMDB).

---

## 1. Trending Lists & Catalog

Pirate sites maintain their "Trending" lists by tracking how many users click an episode on their specific website. This data is isolated and often manipulated. We will build a unified, global "Trending" system using official APIs.

### A. Anime (Powered by AniList GraphQL)

- **The Source:** We query `https://graphql.anilist.co`.
- **Trending:** We use the `sort: TRENDING_DESC` parameter. This returns the global top 50 anime currently being discussed and watched across the entire internet, updating in real-time.
- **Next Release Dates:** AniList provides a `nextAiringEpisode` object containing a precise Unix timestamp. The UI converts this to release labels such as "airs today", "airs tomorrow", or a date/countdown.

### B. Movies & Series (Powered by TMDB)

- **The Source:** We query `https://api.themoviedb.org/3/`.
- **Trending:** We hit the `/trending/all/day` and `/movie/now_playing` endpoints. This allows Kunai to display a gorgeous "In Theaters Now" dashboard.
- **Release Dates:** TMDB provides movie `release_date`, TV `first_air_date`, status, and season episode `air_date`.

## 1.1 Release Schedule Service

Release dates should be owned by a catalog schedule service, not by provider adapters or one-off UI calls.

Canonical follow-up: [catalog-release-schedule-service.md](catalog-release-schedule-service.md)

Required behavior:

- Anime schedule data comes from AniList `nextAiringEpisode` and airing schedule windows.
- TV/series schedule data comes from TMDB season episode `air_date` and TV airing lists where useful.
- Autoplay and prefetch only target released episodes.
- Browse/Discover can show "releasing today" only from cached catalog schedule data.
- Missing release data is `unknown`, not an error and not a guessed next episode.

---

## 2. Deterministic Stream Definitions

When a provider returns a video, it must strictly conform to these definitions so the UI can render the correct badges.

### Languages & Audio

- **Dub:** The audio track is localized (e.g., English Voice Actors).
- **Sub:** The audio track is original (e.g., Japanese Voice Actors).
- **Raw:** Original audio, NO subtitles provided whatsoever.

### Subtitle Formats

- **HardSub:** The subtitle text is literally burned into the video pixels. The user cannot turn it off, change the font, or extract it. The provider sets `isHardsubbed: true`. The UI hides the subtitle toggle.
- **SoftSub:** The subtitles are provided as a separate text file (`.vtt` or `.srt`) or embedded as a toggleable track in the `.m3u8` manifest. The UI allows the user to toggle them and change sizing.
- **SDH:** "Subtitles for the Deaf and Hard of Hearing." (Contains text like `[heavy breathing]`). We filter these out of the SoftSub list unless no standard subtitles are available.

### Seasons & Episodes Mapping

- **Anime (Absolute Mapping):** Anime rarely uses "Season 2, Episode 1". They use absolute numbering (e.g., _One Piece Episode 1159_). The `AniList ID` covers the entire series.
- **Western Series (SxE Mapping):** Western shows use strict Season and Episode numbering (e.g., _Breaking Bad S04E05_). TMDB natively supports this. When passing this to Vidking or Rivestream, we pass both the `TMDB_ID`, `season: 4`, and `episode: 5`.

### Qualities & Sources

- **Source / Provider:** The scraping engine (e.g., `Vidking`).
- **Mirror / Server:** The internal CDN or file host (e.g., `MegaUp`, `Oxygen`, `Vidstreaming`).
- **Quality:** The resolution. Must map to the strict Enum: `"4k" | "1080p" | "720p" | "480p" | "360p" | "auto"`.

---

## 3. The Fallback Ladder (Final Order)

To prioritize speed and minimize Cloudflare/Playwright overhead, the core engine will attempt to resolve providers in this exact order:

**For Anime:**

1.  `Miruro` (0-RAM, Direct API, High Quality)
2.  `AllAnime` (0-RAM, GraphQL, Good Fallback)
3.  `Anikai` (JIT Playwright, Cloudflare Risk - **Last Resort**)

**For Movies / Series:**

1.  `Rivestream` (0-RAM, MurmurHash, Instant)
2.  `Vidking` (0-RAM, WASM Decrypt, Great SoftSubs)
3.  `Cineby` (JIT Playwright Fallback)
