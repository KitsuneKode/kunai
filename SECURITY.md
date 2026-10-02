# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Report privately through GitHub's advisory flow:

https://github.com/KitsuneKode/kunai/security/advisories/new

This opens a private draft visible only to the maintainer. If you cannot use
the advisory flow, open a public issue that says only that you have a security
report, and a maintainer will reach out — do not include details in the public
thread.

## What to include

- The version or commit you tested (`kunai --version`)
- Operating system and terminal
- What you expected vs. what happened
- Steps to reproduce, or a proof-of-concept
- Whether the issue is exploitable from remote content (a provider response,
  a subtitle file, a URL) or only local (requires filesystem or config access)

Remote-content paths matter most here: Kunai consumes titles, overviews, URLs,
subtitles, and headers from third-party provider endpoints, so anything a
provider response can influence — terminal output, spawned process arguments,
written files, outgoing requests — is in scope.

## Response expectations

- Acknowledgment within a few days.
- A fix or a documented mitigation before public disclosure.
- Credit in the advisory and changelog unless you prefer otherwise.

There is no bounty program; this is a community-maintained project.

## Supported versions

Security fixes land on the latest release line only. `kunai --version` tells
you what you are running; `kunai upgrade` (or your install method) moves you
forward.

## What is not a vulnerability

- A provider being down, blocked, or returning bad results — that is a bug,
  report it normally.
- mpv or yt-dlp behavior inside the player itself — report upstream.
- Content on the sites providers scrape — Kunai does not host media.

## Hardening notes

For reference, the load-bearing defenses in this codebase:

- Provider stream URLs are probed through a private-IP/redirect guard before
  playback (`verifyCandidateStream`).
- The optional relay binds loopback by default, allowlists provider hosts, and
  strips credential headers cross-origin.
- Credentials live in the OS keyring when available, else a `0600` file.
- SQLite data and config files are `0600`; logs redact URLs, tokens, and home
  paths.
- Analytics is off unless you explicitly opt in, and sends a hashed install
  id, version, OS, and arch — nothing else.
- Self-update verifies the downloaded binary against the release's
  `SHA256SUMS`. Both artifacts come from the same release origin, so the
  checksum proves transit integrity — GitHub's release integrity is the root
  of trust, and a fully compromised origin could serve a matching pair.
