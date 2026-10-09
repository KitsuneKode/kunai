---
"@kitsunekode/kunai": patch
---

Say missing mpv once.

First launch no longer prints `mpv not found` from both a dedicated
`console.error` and the capability-issue list. `kunai doctor` still reports the
gap once, with remediation labels that keep a space after `openSUSE`.
