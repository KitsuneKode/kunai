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
| `clean-install`                 | PR      | empty HOME → schema-1 layout, no residue          |
| `checksum-rejection`            | PR      | corrupt asset fails; no launcher/manifest         |
| `reinstall-idempotent`          | nightly | same-version reinstall stays consistent           |
| `upgrade-rollback`              | nightly | retention + dry-run + default/`--to`              |
| `stale-lock-recovery`           | nightly | dead lock/txn do not block install                |
| `uninstall-preserves-user-data` | nightly | owned state gone; user data kept                  |
| `custom-xdg-layout`             | nightly | explicit XDG/`KUNAI_BIN_DIR` only                 |

## CI

- PR: `.github/workflows/ci.yml` `installer-docker` matrix runs
  `full-lifecycle/{glibc,musl}` and `checksum-rejection/glibc`.
- Nightly: `.github/workflows/installer-matrix.yml` runs every registry cell.
