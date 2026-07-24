# PowerShell installer harness

Runs `test/integration/install-scripts-pwsh.test.ts` — the `install.ps1` suite —
inside a container that has PowerShell, so it does not need a Windows machine.

```sh
bun run test:installer:pwsh          # build (cached) and run the suite
bun run test:installer:pwsh:shell    # drop into the container instead
```

Sibling of `../native-installer/`, which covers `install.sh` across glibc and
musl. Between them both installers have a local home.

## Why this exists

These tests previously ran only on Windows CI, so `install.ps1` changes were
unverifiable locally and regressions surfaced a push later. The first local run
found the suite already failing 8 of 24, including three genuine `install.ps1`
defects that Windows CI had been passing over:

- `$LASTEXITCODE` read off the end of a `| Select-Object -First 1` pipeline is
  never recorded, so a **successful** `npm root -g` read as a failure.
- `Unblock-File` raises a platform error that `-ErrorAction SilentlyContinue`
  does not suppress.
- The `'User'` environment target and the `WM_SETTINGCHANGE` broadcast are
  Windows-only.

## Expected result

23 passed, 1 skipped. The skip is a genuinely Windows-only PATH-shim case.

## Notes

- The image pins PowerShell but resolves the **ICU package from the package
  index** rather than pinning a soname — it changes every Debian release (72 on
  bookworm, 76 on trixie) and would break on the next base-image bump.
- `node`/`npm` are installed because `install.ps1` fails its `Require-Cmd`
  preflight without them.
- The repo is mounted; `node_modules` is masked with an anonymous volume so the
  container never consumes or corrupts the host's platform-specific install.
- Running a Windows installer on Linux needs `LOCALAPPDATA`/`APPDATA` to exist.
  The harness supplies them via `windowsShellEnvDefaults` rather than teaching
  `install.ps1` about a platform it does not target.
