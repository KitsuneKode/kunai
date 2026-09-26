---
"@kitsunekode/kunai": patch
---

Stop the CLI from claiming things it did not do.

**A corrupt `config.json` no longer destroys its own backup.** The backup was
written to a fixed `.corrupt.bak`, so every launch overwrote the previous one —
a user who hit this twice lost both the original config and any earlier backup.
Because the unreadable file is never rewritten, each later launch re-detected,
re-warned, and re-clobbered it. Backups are now timestamped, the same way a
corrupt SQLite database is already quarantined. The warning also no longer says
the file "has been reset to defaults" when nothing rewrites it.

**Launching without a terminal no longer prints a React stack trace.** With no
TTY — a pipe, `< /dev/null`, a CI step, a desktop launcher — the shell threw
from Ink's stdin hook and the rejection escaped: a react-reconciler stack on
stdout, two more on stderr, and the absolute install path in the output. Kunai
now says what it needs and exits 1. The check sits at the mount site, after
every pipe-aware route has already returned, so nothing legitimate is refused.

**`kunai doctor` gained `--strict`.** Warnings still do not fail by default —
a missing mpv leaves setup and the non-playback shell working, which is why it
is reported as a warning — but a script asking "is this install healthy?" got
exit 0 for an install that cannot play a video. `--strict` makes any warning
non-zero. Informational findings still pass, so a correct source checkout with
no install manifest is not reported as unhealthy.

**Remediation commands are no longer glued to their labels.** The label column
was padded to a hardcoded width that happened to equal the longest label, so
one platform printed `- openSUSEsudo zypper install mpv` — two commands on one
line, neither runnable. The width is now derived from the table.
