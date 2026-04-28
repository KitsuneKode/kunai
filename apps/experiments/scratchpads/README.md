# Provider Scratchpads

This folder is for provider research scripts, packet captures, and notes.

Scratchpads are intentionally separate from production runtime code:

- They may be interactive, noisy, or tied to one title/episode.
- They are allowed to capture wider network traffic while diagnosing a provider.
- They should not be imported by `apps/cli/src/`, bundled into npm, or treated as stable APIs.
- When a finding becomes reliable, move the smallest reusable behavior into `apps/cli/src/` and document the production contract in `.docs/providers.md` or `.docs/diagnostics-guide.md`.

Use this folder when a provider changes behavior and we need to learn the request pattern before hardening the app implementation.
