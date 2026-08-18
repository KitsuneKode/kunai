# Kunai 0.3.1

[`6065233`](https://github.com/KitsuneKode/kunai/commit/606523359ca5436c8ca286a478e56ad32eefa10a) Thanks [@KitsuneKode](https://github.com/KitsuneKode)! - Security and honesty fixes from a full codebase review.

- **Downloads:** provider stream URLs and headers are now guarded before
  reaching yt-dlp (scheme check, leading-dash rejection, `--` terminator,
  CRLF-stripped headers), closing an argv option-injection path the mpv lane
  already blocked.
- **Storage:** the data and cache SQLite files (plus `-wal`/`-shm`) are
  chmod'd to owner-only on every open, matching config and token handling.
- **CLI:** `--jump` help now says what the flag does (auto-pick the n-th
  search result) and warns on invalid values; headless download failures and
  rejected `--handoff-url` values exit nonzero.
- **Playback:** one-shot mpv launches attach the full collected subtitle
  inventory and report the real track count; prefetched and back-navigation
  streams are re-resolved when blocked or older than five minutes instead of
  replaying a possibly expired URL.
- **AniSkip:** the TMDB→MAL fallback is refused beyond season 1 so
  split-cour anime no longer risk wrong auto-skip windows.
- **Docs/palette:** the command-honesty gate now counts the browse palette;
  user docs stop promising `/sync`, `/random`, and `/surprise` as typed
  commands; the keybindings doc's post-playback table matches the code.
