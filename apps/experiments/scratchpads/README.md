# Provider Scratchpads

This folder is for raw provider research scripts, packet captures, and notes.

For workspace-level guidance and runnable script shortcuts, see `../README.md`.

Scratchpads are intentionally separate from production runtime code:

- They may be interactive, noisy, or tied to one title/episode.
- They are allowed to capture wider network traffic while diagnosing a provider.
- They should not be imported by `apps/cli/src/`, bundled into npm, or treated as stable APIs.
- When a finding becomes reliable, write or update the provider dossier / handoff first, then move the smallest reusable behavior into production code.
- Do not promote code directly from here into `packages/*`; shared packages need stable contracts and a Provider SDK boundary first.
- Prefer `source`, `mirror`, and `variant` terms in new notes so research maps cleanly to provider candidate output.
- Capture subtitle, audio, hard-sub, quality, header, expiry, timeout, and browser-runtime evidence separately when observed.

Use this folder when a provider changes behavior and we need to learn the request pattern before hardening the app implementation.
