# Native installer Docker scenarios

Hermetic, real-binary installer lifecycle tests for Linux glibc and musl.

These prove the compiled Kunai binary + `install.sh` + `kunai upgrade` /
`rollback` / `doctor` / `uninstall` contracts in disposable containers with an
isolated `$HOME`. They do **not** prove npm/bun ownership policy — that lives in
[`test/install/`](../../../../../test/install/).

## Commands

```sh
# Default: full-lifecycle on glibc + musl
bun run test:installer:docker

# Named scenario
bun run test:installer:docker:scenario -- checksum-rejection --only glibc
bash apps/cli/test/docker/native-installer/run-local.sh --scenario clean-install

# Discover matrix cells
bash apps/cli/test/docker/native-installer/run-local.sh --list-scenarios
bash apps/cli/test/docker/native-installer/run-local.sh --list-scenarios --gate pr
```

Flags: `--skip-build`, `--skip-image-build`, `--only glibc|musl`, `--scenario <id>`.

### Signed manifests

A binary that embeds a release key refuses an unsigned upgrade, so the mock
release is signed. A build run mints a throwaway Ed25519 key with
[`smoke-key.sh`](./smoke-key.sh), embeds its public half through
`KUNAI_SMOKE_RELEASE_KEY_SPKI`, and `prepare-fixture.sh` writes
`SHA256SUMS{,.archives}.sig` with the private half (`KUNAI_SMOKE_SIGNING_KEY`).
With `--skip-build`, set `KUNAI_SMOKE_SIGNING_KEY` to the key the binaries were
built with; CI ships it beside them as `release-smoke-key.pem`.

## Registry

[`scenarios.tsv`](./scenarios.tsv) columns (tab-separated):

| Column        | Values            |
| ------------- | ----------------- |
| `id`          | scenario name     |
| `variants`    | `glibc,musl`      |
| `gate`        | `pr` or `nightly` |
| `description` | one-line contract |

Comments (`#`) and blank lines are ignored. Duplicate IDs and unknown
variants/gates fail validation.

## Scenarios

| ID                              | Gate    | Contract                                          |
| ------------------------------- | ------- | ------------------------------------------------- |
| `full-lifecycle`                | PR      | install → upgrade → doctor → rollback → uninstall |
| `clean-install`                 | PR      | empty HOME → schema-2 archive layout, no residue  |
| `checksum-rejection`            | PR      | corrupt archive fails; no launcher/manifest       |
| `reinstall-idempotent`          | nightly | same-version reinstall stays consistent           |
| `upgrade-rollback`              | nightly | retention + dry-run + default/`--to`              |
| `stale-lock-recovery`           | nightly | dead lock/txn do not block install                |
| `uninstall-preserves-user-data` | nightly | owned state gone; user data kept                  |
| `custom-xdg-layout`             | nightly | explicit XDG/`KUNAI_BIN_DIR` only                 |

## CI

- PR: `.github/workflows/ci.yml` `installer-docker` matrix runs
  `full-lifecycle/{glibc,musl}` and `checksum-rejection/glibc`.
- Nightly: `.github/workflows/installer-matrix.yml` runs every registry cell.
