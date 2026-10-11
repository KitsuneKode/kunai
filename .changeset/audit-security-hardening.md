---
"@kitsunekode/kunai": patch
---

Harden the untrusted-input and shared-tmp surfaces from the security audit.

A `kunai://` handoff link opened by the desktop handler used to run provider
network lookups (anime catalog-id mapping) before the local confirmation prompt.
The confirmation now runs first: an external link can no longer make Kunai emit
catalog ids or session state to providers without consent, and anime anchors map
against the anime lane's own provider instead of whatever lane the session last
used. `--open` combined with `--handoff-url`, and whitespace inside a handoff
URL — both smells of a tokenizing launcher smuggling extra argv — are now usage
errors.

Temporary playback manifests (the rewritten HLS playlist and generated DASH
MPD) embed signed CDN URLs; their tmp dirs and files are now owner-only
(0700/0600) instead of world-readable in a shared `/tmp`. The HLS manifest
prefetch keeps its deadline armed through the body read, caps the body at 2 MiB,
and honors the caller's abort signal. The Windows mpv IPC pipe name carries
128-bit randomness — the only thing between a same-session process and mpv's
`run` command — and the Linux `.desktop` `Exec` line now escapes `%` field-code
characters.

The share codec's optional text fields (`n`, `src`, `sq`, catalog ids) are
truncated to the same bounds `q` already had instead of being accepted
unbounded, and `source_inventory` rows get a structural shape check on read so a
corrupt row is reported as corrupt instead of handing garbage to the playback
path.
