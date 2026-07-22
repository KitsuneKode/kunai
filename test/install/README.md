# Installer scenarios

Two complementary harnesses:

| Harness                        | Entry                              | Proves                                            |
| ------------------------------ | ---------------------------------- | ------------------------------------------------- |
| **Ownership (this directory)** | `bun run test:installer:scenarios` | PATH / package-manager ownership with stub assets |
| **Docker native matrix**       | `bun run test:installer:docker`    | Real glibc/musl binaries + full lifecycle         |

See [`apps/cli/test/docker/native-installer/README.md`](../apps/cli/test/docker/native-installer/README.md)
for the Docker scenario registry (`--scenario`, `--list-scenarios`).

## Ownership scenarios (this directory)

Execution-level tests for `install.sh` ownership policy. Every other update test
in the repo mocks the filesystem and network; these actually run the installer
and assert what ended up on disk and on `PATH`.

```sh
bun run test:installer:scenarios       # all scenarios (canonical entry point)
test/install/run.sh                    # all scenarios
test/install/run.sh npm-contamination  # one
```

These scenarios run as a blocking CI gate. The `Installer ownership scenarios`
job runs `bun run test:installer:scenarios` whenever the installer path filter
matches, so a regression in installer ownership fails the build.

Each scenario runs in a fresh, network-less container as a non-root user with a
real `$HOME`, so state never leaks between runs and never touches your own
install. `install.sh` is bind-mounted from the working tree, so scenarios always
test your current changes rather than a copy baked into the image.

## How it stays hermetic

`install.sh` takes `KUNAI_DL_BASE`, `KUNAI_RELEASES_API`, `KUNAI_BIN_DIR` and
`KUNAI_DATA_DIR` as overrides, and `curl` handles `file://` URLs. So
`make-fake-release.sh` writes a release tree to disk and the installer consumes
it directly — no HTTP server, no ports, no daemons, no network.

## What these prove, and what they don't

The served asset is a stub script that reports a version, **not a real Kunai
build**. These scenarios prove install _mechanics_: version resolution, asset
naming, checksum verification, on-disk layout, and which binary owns `PATH`.

They do not prove the shipped binary runs. That belongs to the Docker native
matrix and compiled binary smokes. Keep the two honest and separate — a stub
passing here is not evidence that a release works.

## Scenarios

| Scenario                 | Covers                                               |
| ------------------------ | ---------------------------------------------------- |
| `npm-contamination`      | npm global install, then native install over the top |
| `source-data-separation` | Source checkout vs runtime data/config/cache roots   |

### npm-contamination

The likeliest real-world breakage: a user installs via npm, later installs
natively, and ends up with two `kunai` on `PATH`. Which one runs is decided by
`PATH` order, not by which is newer.

This scenario found a real defect on its first run. `install.sh` reported
`Done. kunai is on PATH` while `kunai --version` still returned the old npm
build — the native binary was installed correctly but shadowed, and the
manifest claimed `channel: binary` while the user ran an npm shim. The in-app
installer already handled this (`services/update/run-install.ts` →
`cleanupNpmInstallations`); the shell installer did not. Fixed by
`resolve_conflicting_installs` in `install.sh`.

## Adding a scenario

Drop an executable `scenarios/<name>.sh`. It runs as `/harness/scenario.sh` with
`install.sh`, `make-fake-release.sh` and `stub-npm-package` mounted under
`/harness`. Exit non-zero to fail.

Assert invariants rather than exit codes — the defect above was invisible to
exit codes, because the installer genuinely succeeded at installing. What was
wrong was the state it left behind.

Native binary lifecycle scenarios (checksum rejection, rollback, XDG layout,
etc.) belong in the Docker matrix under
`apps/cli/test/docker/native-installer/scenarios.tsv`, not here.
