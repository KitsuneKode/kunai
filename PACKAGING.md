# Packaging checklist (beta)

Use this before tagging a public beta or publishing packages.

## Version and metadata

- [ ] Bump version in the release-owned manifest(s) and changelog entry
- [ ] `LICENSE` present and referenced from package metadata
- [ ] `bun run typecheck`, `bun run lint`, `bun run fmt`, and `bun run test` clean on the release commit

## Install surfaces

- [ ] **npm / Git** — documented clone + `bun install` + optional `bun run link:global` ([README](README.md), [.docs/quickstart.md](.docs/quickstart.md))
- [ ] **Runtime requirements match shipped providers** — user-facing docs only list active runtime requirements (`mpv` required, optional `ffmpeg`/terminal image support) and avoid stale browser-runtime setup steps
- [ ] **Platform install guidance is present** — Linux/macOS commands plus Windows package-manager options are documented in root README + npm README + quickstart
- [ ] **Download path docs are platform-accurate** — default download directory matches storage path resolution on Linux/macOS/Windows
- [ ] **AUR / brew** — track separately when maintainers pick up the release; keep CLI flags in sync with `--help` / quickstart

## Smoke

- [ ] Golden / scripted checks from [.plans/playback-golden-state-verifications.md](.plans/playback-golden-state-verifications.md) where regressions hurt
- [ ] `apps/cli/test/live/` smoke subset on a maintainer machine before wide announce

## Support

- [ ] `/ export-diagnostics` (redacted JSON) documented for users filing issues ([.docs/quickstart.md](.docs/quickstart.md))
