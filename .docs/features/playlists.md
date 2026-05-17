# Playlists

Kunai playlists are durable, shareable taste artifacts. They are separate from the runtime queue.

## Internal Storage

Durable playlist rows live in SQLite and store:

- playlist metadata
- item identity
- order
- optional notes
- provider hints

They do not store playback progress internally. Progress is projected from watch history when the UI needs it.

## Import And Export

Use `/playlist` to:

- save the current runtime queue as a durable playlist
- export a durable playlist to Kunai's playlist exchange folder
- import a Kunai playlist JSON file from the same folder

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

Imported unresolved items are inert until explicitly resolved. They must not autoplay from guesses or replace the current queue.

## Service Boundary

The durable playlist service creates playlist rows, appends identity-only items, and exports safe Kunai playlist documents. It projects progress from history at export or render time instead of copying mutable progress into playlist storage.
