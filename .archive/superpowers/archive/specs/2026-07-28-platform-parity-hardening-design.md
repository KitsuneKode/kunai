# Platform Parity Hardening Design

## Goal

Make Kunai's supported Linux, macOS, and Windows paths exercise the same user-visible contracts instead of passing CI through platform skips, mocked helpers, or direct-binary bypasses.

## Design

Host-specific command construction belongs in small injectable helpers. The PTY helper will be reused by every `script(1)` harness; clipboard command selection will explicitly cover Windows, macOS, Wayland, and X11; and browser opening will use a direct Windows executable rather than feeding remote URLs through `cmd.exe` parsing. AniList and TMDB authorization will reuse that shared browser opener while retaining their printed manual URLs.

Native CI will install and assert the presence of mpv before running the CLI suite. Windows CI will exercise the Node npm launcher around the compiled executable, and release smoke will execute the advertised Windows ARM64 artifact on a native ARM64 runner. Installer- and CI-infrastructure-only changes will route through the native parity jobs.

Secret-bearing config JSON will use the existing owner-only atomic writer on POSIX. macOS-facing verification scripts will support stock BSD userland by selecting `shasum` when `sha256sum` is unavailable and avoiding Bash features absent from the system Bash.

## Error Handling

Clipboard operations remain best-effort and return their existing typed success/null results. OAuth URLs remain printed even if automatic opening fails. CI installation or native execution failures are blocking and attributable to named steps. Permission changes preserve Windows ACL behavior by skipping POSIX `chmod` there.

## Verification

Add unit contracts for every command resolver and config file mode, reuse the PTY regression tests, and add Windows launcher coverage around a real PE binary in CI. Run targeted unit/integration tests, shell syntax checks, workspace typecheck/lint/format, the CLI suite, storage suite, and the full build before committing.
