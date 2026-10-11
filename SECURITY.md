# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). That opens a private advisory where
we can coordinate a fix and disclosure without exposing users in the meantime.

If private reporting is unavailable to you, contact
[@KitsuneKode](https://github.com/KitsuneKode) on GitHub to arrange a channel.

Reports are handled on a best-effort basis — this is a community-maintained
project — but a clear reproduction (what you ran, what happened, what you
expected) gets triaged fastest.

## Supported versions

Only the latest release is supported. Kunai ships as a rolling CLI; fixes land
on `main` and go out in the next release rather than being backported to older
tags. `kunai doctor` reports the version; `kunai upgrade` updates it.

## Scope

Kunai launches external tools (`mpv`, `curl`/`curl-impersonate`, `yt-dlp`,
`ffprobe`), fetches remote stream metadata and media URLs, and stores local
state (SQLite history/cache, config, an install manifest). The kinds of reports
most relevant here:

- **Argument or command injection** into a spawned process — e.g. a provider
  response or URL reaching argv unescaped.
- **SSRF or unsafe redirects** in stream resolution, the relay, or update
  downloads (redirects are screened; bypasses matter).
- **Local privilege/integrity issues**: installer or updater writing outside
  its install root, unsafe file permissions on credentials or locks, lock
  ownership confusion between concurrent processes.
- **Secrets exposure**: tokens, cookies, or private URLs leaking into logs,
  support bundles, the `--debug` log, or analytics payloads. Analytics must
  stay strictly opt-in — a path that sends anything without an explicit
  user action is a bug worth reporting.
- **Supply chain**: tampered or mismatched release/update artifacts, or the
  checksum verification being skippable.

## Out of scope

- Vulnerabilities in `mpv`, `curl`, `yt-dlp`, or providers' upstream sites
  themselves — report those to their own projects.
- Content returned by third-party provider sites (ads, tracking on their end).
- Attacks requiring the ability to modify Kunai's own files or environment —
  if an attacker already controls that layer, the threat model is different.
- The public docs site's static hosting provider.

## What to expect

1. Acknowledgement of the report.
2. A fix or a documented decision, coordinated in the private advisory.
3. Credit in the release notes if you want it.

Please give us reasonable time to ship a fix before public disclosure.
