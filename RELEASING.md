# Releasing Kunai

This repo uses Changesets + Turborepo for versioning, changelogs, and release notes.

## One-time setup

- Keep `main` as the release branch.
- Configure npm Trusted Publishing (OIDC) for `@kitsunekode/kunai`:
  - npm package settings -> Trusted publishers
  - GitHub repository: `kitsunekode/kunai`
  - Workflow file: `.github/workflows/release.yml`
- No long-lived `NPM_TOKEN` is required once Trusted Publishing is enabled.

## First stable release (0.1.0 bootstrap)

- Keep package versions at `0.1.0` in `apps/cli/package.json` and `packages/*/package.json`.
- Ensure there are no pending `.changeset/*.md` files for this bootstrap cut.
- Merge release-prep changes into `main`, then run the `Release` workflow via `workflow_dispatch` once.
- After `0.1.0` is published, return to normal per-change changeset workflow below.

## Per-change workflow

1. Implement the change.
2. Run `bun run changeset` and select impacted packages.
3. Commit the generated `.changeset/*.md` file.
4. Keep changeset summaries user-facing (what changed, why it matters).

## Automated release flow

- `Release` workflow runs on pushes to `main`.
- If unpublished changesets exist, it opens/updates a version PR (`chore: version packages`).
- Merging that PR triggers publish:
  - applies package version bumps via `changeset version`
  - updates `CHANGELOG.md` entries from changesets
  - publishes to npm via `changeset publish`
  - uses OIDC (`id-token: write`) with npm provenance enabled
  - creates GitHub release notes from changelog entries

## Local release utilities

- `bun run changeset` -> create release intent files
- `bun run version:packages` -> apply pending versions + changelog updates
- `bun run release` -> publish via Changesets (used by workflow)

## Platform-focused release notes checklist

Use this structure in changeset summaries/changelog notes:

- Linux: distro/package-manager notes, shell requirements, mpv/ffmpeg/terminal caveats.
- macOS: Homebrew/manual install notes, permissions/signing caveats.
- Windows: WSL/native support status, path/shell caveats.
- Shared: behavior changes, migration steps, known limitations.

Dependency truth-sync before publish:

- Root README, npm README, and quickstart must agree on required runtime (`mpv`) and optional runtime (`ffmpeg`, terminal image stack).
- If dependency guidance changes, include platform install snippets for Linux/macOS and Windows package-manager options.
- Confirm default download path docs match runtime storage paths.

If a release has no platform-specific impact, state "No platform-specific changes."
