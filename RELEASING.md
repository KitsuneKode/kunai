# Releasing Kunai

This repo uses Changesets + Turborepo for versioning, changelogs, and release notes.

**Published package:** `@kitsunekode/kunai` (`apps/cli/`). Internal `@kunai/*` workspace packages are not published.

## One-time setup

- Keep `main` as the release branch.
- Configure npm Trusted Publishing (OIDC) for `@kitsunekode/kunai`:
  - npm package settings → Trusted publishers
  - GitHub repository: `kitsunekode/kunai`
  - Workflow file: `.github/workflows/release.yml`
- Configure the GitHub Actions environment `release-production` with required reviewers (publication waits on approval).
- No long-lived `NPM_TOKEN` is required once Trusted Publishing is enabled. The publish job may still pass `NODE_AUTH_TOKEN` for registry auth compatibility alongside OIDC (`id-token: write`).

## Per-change workflow (normal releases)

1. Implement the change on a branch.
2. Run `bun run changeset` and select `@kitsunekode/kunai` when prompted.
3. Commit the generated `.changeset/*.md` file with your feature/fix commits.
4. Open a PR. The **Release Guard** workflow runs `bun run guard` and fails on version/changelog drift.
5. Merge to `main`. The **Release** workflow opens or updates a version PR only — it never publishes on push.
6. Review and merge the version PR (`chore: version packages`). That commit bumps `apps/cli/package.json`, both changelogs, and regenerates staged `.release/kunai-vX.Y.Z.{md,json}` artifacts.
7. Manually dispatch **Release** with the exact version string (must match `apps/cli/package.json`) and the provider signoff run id, wait for **confirmation**, approve `release-production`, and let candidate → confirmation → publish → metadata complete.

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

## Release metadata (schema v2)

Each `.release/kunai-vX.Y.Z.json` carries publication state:

| `status`    | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `staged`    | Versioned and reviewed locally; **not** public history. Docs show it under Upcoming only. |
| `published` | npm + GitHub tag/assets verified; eligible as public latest.                              |
| `withdrawn` | Retired from public latest/history surfaces; keeps any existing `publishedAt`.            |

Rules:

- New artifacts from `bun run release:notes` / `version:packages` default to `status: "staged"` and `publishedAt: null`.
- Only `bun run scripts/set-release-status.ts` should flip status (never hand-edit for routine releases).
- `published` → `staged` is forbidden; use `withdrawn` to retire.
- Docs public latest is the newest **published** artifact. Example: **0.2.5** is published latest; **0.2.6** may exist as staged and must not appear as history or latest until promoted.

```sh
bun run scripts/set-release-status.ts <version> staged
bun run scripts/set-release-status.ts <version> published <ISO-8601>
bun run scripts/set-release-status.ts <version> withdrawn
```

## Staged promotion workflow

Event split in `.github/workflows/release.yml`:

### 1. Push to `main` → version PR only

Job **`version-pr`**: `changesets/action` runs `bun run version:packages` and opens/updates `chore: version packages`. No npm publish, no tags, no GitHub Releases.

After the version PR merges, expect:

- Bumped `@kitsunekode/kunai` version in `apps/cli/package.json`
- Updated `apps/cli/CHANGELOG.md` + root `CHANGELOG.md`
- Staged `.release/kunai-vX.Y.Z.md` + `.release/kunai-vX.Y.Z.json` (`status: staged`)

### 2. Manual dispatch → build preserved candidate

Actions → **Release** → **Run workflow** → set `version` to the exact semver (e.g. `0.3.0`) and `provider_signoff_run_id` to the Actions run that uploaded `release-provider-signoff-<id>`.

Job **`candidate`** (no publish):

1. Asserts `inputs.version` equals `apps/cli/package.json` `version`
2. `bun run ci` → `build` → `pkg:check` → real npm global install → `guard` → `release:notes:check`
3. Builds all 8 release binaries, verifies them, runs compiled binary smoke
4. `bun run release:pack` → `.release-candidate/kunai-npm.tgz`
5. Uploads artifact `kunai-release-candidate-<version>` (8 binaries + `SHA256SUMS` + `kunai-npm.tgz`, 14-day retention)

`release:pack` is:

```sh
mkdir -p .release-candidate && ROOT="$PWD" && \
  (cd apps/cli && bun pm pack --ignore-scripts --quiet --filename "$ROOT/.release-candidate/kunai-npm.tgz")
```

### 3. Confirmation gate (still no publish)

Job **`confirmation`** needs `candidate`. It downloads the preserved candidate binaries, pulls the provider signoff artifact from `provider_signoff_run_id`, and runs:

```sh
bun run release:confirmation:check -- \
  --version <version> \
  --commit <sha> \
  --provider-evidence artifacts/release-provider-signoff.json \
  --provider-signoff-run-id <run_id> \
  --binary-dir apps/cli/dist/bin
```

Expected machine-readable `ready-for-confirmation` JSON. Nothing has been published yet.

### 4. Protected publication (no rebuild)

Job **`publish`** needs `confirmation` and declares `environment: release-production`. After approval it:

1. Downloads the preserved candidate artifact (does **not** rebuild or re-pack)
2. Reverifies binaries against the expected version
3. `bun publish .release-candidate/kunai-npm.tgz --access public`
4. Retries `npm view @kitsunekode/kunai@<version>` until visible
5. Creates annotated tag `v<version>` and pushes it
6. Creates a **draft** GitHub release (`make_latest: false`) with the nine required assets
7. `bun run scripts/verify-github-release-assets.ts <tag> --expect-draft …`
8. Promotes: `gh release edit <tag> --draft=false --latest`
9. Verifies the public release assets again

### 5. Metadata after public verification

Job **`metadata`** runs only after publish succeeds:

```sh
bun run scripts/set-release-status.ts <version> published <UTC-ISO>
```

Then focused release-artifact tests, `release:notes:check`, and a narrow commit/push of `.release/kunai-v<version>.json` (`chore(release): mark vX.Y.Z published`). No force-push.

## Metadata push recovery

The metadata job authenticates with `GITHUB_TOKEN`. If branch protection blocks that push:

1. Confirm npm, tag `vX.Y.Z`, and the public GitHub release are already correct.
2. Locally on a clean checkout of the dispatch ref:

```sh
bun run scripts/set-release-status.ts <version> published <UTC-ISO>
git add .release/kunai-v<version>.json
git commit -m "chore(release): mark v<version> published"
git push
```

3. Prefer a fine-grained PAT (or classic PAT) with **contents: write** that bypasses the bot restriction, either for the manual push or as a repo secret wired into the metadata job checkout token. Do not force-push and do not re-run publish solely to fix metadata.

## Related automation

- **Release Guard** (`.github/workflows/release-guard.yml`): PR-time check that `package.json`, both changelogs, pending changesets, and installer/release paths agree.
- **CI** (`.github/workflows/ci.yml`): parallel Turbo jobs; installer Docker smoke when installer paths change.
- `version:packages` runs `changeset version`, mirrors changelog, and regenerates `.release/kunai-v*.md` / `.json` via `bun run release:notes`.

**npm vs GitHub Release artifacts:** npm publishes the preserved `kunai-npm.tgz` (allowlisted `dist/kunai.js` + `dist/assets/**`). Standalone binaries ship only via the GitHub release — `bun run pkg:check` fails if `dist/bin/` appears in the npm tarball.

## GitHub release tags

Prefer tag `vX.Y.Z` created by the **publish** job with the nine required assets (8 binaries + `SHA256SUMS`). Release notes body comes from `.release/kunai-vX.Y.Z.md`. Avoid duplicate `@kitsunekode/kunai@X.Y.Z` releases with empty bodies.

## Local release utilities

- `bun run changeset` → create release intent files
- `bun run version:packages` → apply pending versions + update both changelogs + staged `.release` notes
- `bun run release:pack` → write `.release-candidate/kunai-npm.tgz` (same packing path CI uses)
- `bun run release` → `bun publish` of the preserved tarball (CI publish job in practice)
- `bun run guard` → verify version ↔ changelog sync locally (also runs on pre-commit when release files change)
- `bun run scripts/set-release-status.ts` → flip staged / published / withdrawn on one artifact

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

## Reconciling a bad release (emergency only)

If a version was hand-shipped without a changeset (e.g. historical drift):

1. Align `apps/cli/package.json`, `apps/cli/CHANGELOG.md`, and root `CHANGELOG.md` manually.
2. Run `bun run guard` — it must pass.
3. Fix `.release` status with `set-release-status.ts` (`published` / `withdrawn` as appropriate).
4. Resume normal changeset → version PR → dispatch promotion for the next version; do not hand-bump again.
