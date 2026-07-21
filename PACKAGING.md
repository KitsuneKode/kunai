# Packaging checklist (beta)

Use this before cutting a public release via the staged promotion workflow ([RELEASING.md](RELEASING.md)).

## Version and metadata

- [ ] Version PR merged (`chore: version packages`) — do not hand-bump `apps/cli/package.json`
- [ ] `.release/kunai-vX.Y.Z.json` exists with `schemaVersion: 2`, `status: "staged"`, `publishedAt: null`
- [ ] Staged versions are **not** treated as public latest (example: 0.2.6 staged while 0.2.5 remains published latest)
- [ ] `LICENSE` present and referenced from package metadata
- [ ] `bun run typecheck`, `bun run lint`, `bun run fmt`, and `bun run test` clean on the release commit
- [ ] `bun run guard` and `bun run release:notes:check` pass

## Candidate artifacts (before approval)

Built only by **Release** `workflow_dispatch` with the exact version; publish must not rebuild.

- [ ] Dispatch version matches `apps/cli/package.json`
- [ ] Candidate job produced preserved upload: 8 binaries + `SHA256SUMS` + `kunai-npm.tgz`
- [ ] Local/CI packing path is `bun run release:pack` → `.release-candidate/kunai-npm.tgz` via:

```sh
ROOT="$PWD" && (cd apps/cli && bun pm pack --ignore-scripts --quiet --filename "$ROOT/.release-candidate/kunai-npm.tgz")
```

- [ ] `bun run pkg:check` — npm tarball must not contain `dist/bin/`

## Install surfaces

- [ ] **npm / Git** — documented clone + `bun install` + optional `bun run link:global` ([README](README.md), [.docs/quickstart.md](.docs/quickstart.md))
- [ ] **Runtime requirements match shipped providers** — user-facing docs only list active runtime requirements (`mpv` required; optional `yt-dlp`, optional `ffprobe`, terminal image stack) and avoid stale browser-runtime setup steps
- [ ] **Platform install guidance is present** — Linux/macOS commands plus Windows package-manager options are documented in root README + npm README + quickstart
- [ ] **0.3.0 support matrix is exact** — four Linux targets supported; macOS x64/arm64 beta; Windows x64 beta; Windows ARM64 experimental; WSL = Linux env; BSD unsupported binary ([docs/users/supported-and-unsupported.mdx](docs/users/supported-and-unsupported.mdx), [README](README.md))
- [ ] **Alpine + WSL recipes present** — `apk add mpv yt-dlp ffmpeg` + install.sh; Windows-native vs WSL PATH/mpv/data separated
- [ ] **Installer troubleshooting present** — `type -a` / `which -a` (bash), `whence -a` (zsh), `Get-Command kunai -All` (PowerShell), doctor text/JSON, ownership, checksum/404 (`kunai install --force` / pin version), rollback, uninstall-by-owner, unsigned binaries, PATH shadowing ([docs/users/troubleshooting.mdx](docs/users/troubleshooting.mdx#installer-and-path-issues))
- [ ] **YouTube cookie safety documented** — `cookiesFromBrowser` / absolute `cookiesFile`; never paste contents; review redacted bundles; no DRM bypass claim
- [ ] **Download path docs are platform-accurate** — default download directory matches storage path resolution on Linux/macOS/Windows
- [ ] **GitHub Release assets** — all 8 binaries + `SHA256SUMS` present (`bun run scripts/verify-github-release-assets.ts`); upload uses `fail_on_unmatched_files: true`

## Publication (protected)

- [ ] Confirmation gate green (`bun run release:confirmation:check`) with fresh provider signoff evidence
- [ ] Approve GitHub environment `release-production` only after confirmation evidence looks correct
- [ ] Publish job downloads preserved artifacts and runs `bun publish .release-candidate/kunai-npm.tgz --access public`
- [ ] Draft GitHub release verified (`--expect-draft`) before `gh release edit … --draft=false --latest`
- [ ] Metadata job (or recovery) marks `.release/kunai-vX.Y.Z.json` `published` via `set-release-status.ts`

## Smoke

- [ ] Golden / scripted checks from [.plans/playback-golden-state-verifications.md](.plans/playback-golden-state-verifications.md) where regressions hurt
- [ ] `apps/cli/test/live/` smoke subset on a maintainer machine before wide announce

## Support

- [ ] `/ export-diagnostics` (redacted JSON) documented for users filing issues ([.docs/quickstart.md](.docs/quickstart.md))
