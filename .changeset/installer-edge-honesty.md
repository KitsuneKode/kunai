---
"@kitsunekode/kunai": patch
---

Installer and doctor fixes from the issue backlog.

- `install.sh` now honors the documented environment fallbacks —
  `KUNAI_INSTALL_METHOD`, `KUNAI_INSTALL_VERSION`, `KUNAI_INSTALL_YES`,
  `KUNAI_INSTALL_DRY_RUN`, and `KUNAI_SKIP_DEPS` join the already-working
  `KUNAI_SKIP_PATH_UPDATE`, matching `install.ps1`'s contract (#453).
- Both installers refuse to run as root / elevated by default. A `sudo` or
  Administrator install lands Kunai in the wrong profile and the user never
  gets it on PATH — with no error anywhere. Containers and deliberate system
  installs opt in via `KUNAI_INSTALL_ALLOW_ROOT=1` /
  `KUNAI_INSTALL_ALLOW_ELEVATED=1`; a root `--dry-run` still prints the plan
  (#454).
- `install.sh --help` works under the documented `curl | bash -s --` route:
  `usage()` no longer `sed`s `$0` when it is the shell instead of the script
  (#455).
- `kunai doctor` exits non-zero when mpv is missing — the one dependency
  playback cannot run without — while lane-conditional gaps (yt-dlp, ffmpeg,
  curl) remain warnings (#452). Doctor's remediation table also stops gluing
  `openSUSE` onto `sudo zypper …`: the label pad is now computed from the
  longest label instead of a fixed 8.
