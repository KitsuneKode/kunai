# Releasing Kunai

This repo uses Changesets + Turborepo for versioning, changelogs, and release notes.

**Published package:** `@kitsunekode/kunai` (`apps/cli/`). Internal `@kunai/*` workspace packages are not published.

## One-time setup

- Keep `main` as the release branch.
- Configure npm Trusted Publishing (OIDC) for `@kitsunekode/kunai`:
  - npm package settings → Trusted publishers
  - GitHub repository: `kitsunekode/kunai`
  - Workflow file: `.github/workflows/release.yml`
- No long-lived `NPM_TOKEN` is required once Trusted Publishing is enabled.

## Per-change workflow (normal releases)

1. Implement the change on a branch.
2. Run `bun run changeset` and select `@kitsunekode/kunai` when prompted.
3. Commit the generated `.changeset/*.md` file with your feature/fix commits.
4. Open a PR. The **Release Guard** workflow runs `bun run guard` and fails on version/changelog drift.
5. Merge to `main`. The **Release** workflow (scoped to `apps/cli/**` and `.changeset/**`) then:
   - opens or updates a version PR (`chore: version packages`) if unpublished changesets exist, or
   - publishes immediately when the version PR is merged.

**Never hand-edit** `apps/cli/package.json` `version` or `apps/cli/src/main.ts` for releases. Runtime version (`KUNAI_VERSION`) is derived from `package.json` at build time.

## Changeset body convention

Write user-facing release notes in the changeset body. Prefer this shape so `scripts/sync-root-changelog.ts` can mirror a clean narrative to the root changelog:

```markdown
Short one-line summary of the release.

### Highlights

- ...

### Features

- ...

### Fixes

- ...

### Performance

- ...
```

`### Highlights`, `### Features`, `### Fixes`, and `### Performance` are optional but recommended. If a release has no platform-specific impact, say so explicitly.

## Changelog ownership

| File                       | Role                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/CHANGELOG.md`    | **Canonical.** Updated by `changeset version`; ships with the npm package.                                                                                      |
| `CHANGELOG.md` (repo root) | **Mirrored narrative view.** Auto-updated by `bun run scripts/sync-root-changelog.ts` during `bun run version:packages`. Do not hand-edit for routine releases. |

## Automated release flow

- **Release Guard** (`.github/workflows/release-guard.yml`): PR-time check that `package.json`, both changelogs, and pending changesets agree.
- **Release** (`.github/workflows/release.yml`): runs on pushes to `main` that touch release paths. Steps:
  1. `bun run ci` + `bun run build` + `bun run pkg:check`
  2. `bun run guard`
  3. `changesets/action`: `bun run version:packages` then `bun run release`
- `version:packages` runs `changeset version` then mirrors the new per-package entry to the root changelog.
- Publish uses OIDC (`id-token: write`) with npm provenance enabled.
- GitHub releases are created from changelog entries by the changesets action.

## Local release utilities

- `bun run changeset` → create release intent files
- `bun run version:packages` → apply pending versions + update both changelogs
- `bun run release` → publish via Changesets (CI only in practice)
- `bun run guard` → verify version ↔ changelog sync locally (also runs on pre-commit when release files change)

## Platform-focused release notes checklist

Use this structure in changeset summaries/changelog notes:

- **Linux:** distro/package-manager notes, shell requirements, mpv / yt-dlp / optional ffprobe / terminal caveats.
- **macOS:** Homebrew/manual install notes, permissions/signing caveats.
- **Windows:** WSL/native support status, path/shell caveats.
- **Shared:** behavior changes, migration steps, known limitations.

Dependency truth-sync before publish:

- Root README, npm README, and quickstart must agree on required runtime (`mpv`) and optional runtime (`yt-dlp`, optional `ffprobe`, terminal image stack).
- If dependency guidance changes, include platform install snippets for Linux/macOS and Windows package-manager options.
- Confirm default download path docs match runtime storage paths.

## GitHub release tags

Prefer a single tag convention per version. The manual `v0.2.5` style release (`Kunai v0.2.5`) is the user-facing default. Avoid leaving duplicate auto-generated `@kitsunekode/kunai@X.Y.Z` releases with empty bodies.

## Reconciling a bad release (emergency only)

If a version was hand-shipped without a changeset (e.g. v0.2.5 drift):

1. Align `apps/cli/package.json`, `apps/cli/CHANGELOG.md`, and root `CHANGELOG.md` manually.
2. Run `bun run guard` — it must pass.
3. Resume normal changeset workflow for the next version; do not hand-bump again.
