# Queue

Kunai treats the queue as runtime watch intent, not a durable taste artifact.

The queue is checkpointed to SQLite so crashes do not silently destroy user intent. On next startup, prior active sessions with pending queue items are marked recoverable and exposed as a notification.

## Rules

- queue recovery never autoplays
- queue recovery never silently replaces current playback
- restore is a user action from the inbox
- queue items store title identity and provider hints, not stream URLs
- streams are resolved late when playback or download actually needs them

## Placement

Shared media actions support:

- queue next
- queue after current series
- queue at end

These actions can be offered from notifications, history, recommendations, search, playlists, and post-playback surfaces without each surface inventing queue policy.

The current shell exposes:

- `/notifications`: `Enter` restores recoverable queues or queues new episode notices
- `/history`: `q` queues the selected history item without replacing playback
- search, trending, and recommendation browse rows: `q` queues the highlighted row without opening it
- post-playback recommendation rail: `1`, `2`, or `3` queues the visible pick without leaving the post-playback controls
- post-playback recommendation actions: `i` opens details/download actions; download requires confirmation before provider resolution

## Restore API

Recoverable queue sessions can be restored into the current session through the queue service. This operation moves only pending items, closes the old queue session, and leaves playback untouched until the user chooses a play action.

The restore path is intentionally explicit so crash recovery is durable without creating surprise autoplay after restart.
