# Playlists

Kunai playlists are durable, shareable taste artifacts. They are separate from the runtime queue.

Current command surface:

- `/playlists` opens durable saved playlists.
- `/playlist` and `/pl` are compatibility aliases for `/playlists`.
- `/up-next` opens the current playback order.

## Internal Storage

Durable playlist rows live in SQLite and store:

- playlist metadata
- item identity
- order
- optional notes
- provider hints

They do not store playback progress internally. Progress is projected from watch history when the UI needs it.

## Import And Export

Use `/playlists` to:

- load a durable playlist into Up Next
- export a durable playlist to Kunai's playlist exchange folder
- import a Kunai playlist JSON file from the same folder

Use `/up-next` to save the current runtime order as a durable playlist.

The exchange folder is `playlists/` under Kunai's app data directory.

Kunai playlist exports include:

- format/version
- playlist name
- item identity
- order
- provider hints
- optional progress percentage snapshot

Exports must never include:

- raw stream URLs
- request headers
- cookies
- auth tokens
- local file paths

Imported unresolved items are inert until explicitly resolved. They must not autoplay from guesses or replace the current Up Next order.

## Service Boundary

The durable playlist service creates playlist rows, appends identity-only items, and exports safe Kunai playlist documents. It projects progress from history at export or render time instead of copying mutable progress into playlist storage.

`add-to-playlist` must choose a specific durable playlist. It must not silently write to Watchlist. Watchlist has its own explicit actions and aliases.
