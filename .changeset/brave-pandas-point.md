---
"@kitsunekode/kunai": patch
---

Give the Discord presence card a play button that is distinct from the catalog link.

### Fixes

- The presence card exposed four clickable surfaces resolving to at most two
  destinations, and the play target was not one of them. For a movie, or an
  anime known only by an AniList id, the poster, title, state row, and the
  single button all collapsed onto one identical URL, because neither has a
  distinct episode page for `state_url` to point at.
- `state_url` is now set only when the episode page is a different destination
  from the title page, so the title and state rows stop repeating one link.

### Behavior

- Presence now fills both button slots Discord allows: **Play on Kunai**,
  carrying the https web-share URL for the live playback target, followed by the
  catalog button. The catalog button is dropped when it would resolve to the
  play target.
- The play button uses the web-share route rather than the `kunai://` ref
  because Discord rejects any button URL that is not http(s); the web route
  hands off to `kunai://` on open. A title with no catalog ids still gets the
  play button, where it previously got no buttons at all.
- The `kunai://` ref stays in the presence state line and in `playable_ref`, so
  copy-paste is unchanged. Private-privacy playback still emits no buttons.
