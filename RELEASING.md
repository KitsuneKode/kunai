# Releasing Kunai

This repo uses Changesets + Turborepo for versioning, changelogs, and release notes.

**Published package:** `@kitsunekode/kunai` (`apps/cli/`). Internal `@kunai/*` workspace packages are not published.

## One-time setup

- Keep `main` as the release branch.
- An npm owner must ensure that the complete public package set exists once:

  ```text
  @kitsunekode/kunai
  @kitsunekode/kunai-darwin-arm64
  @kitsunekode/kunai-darwin-x64
  @kitsunekode/kunai-linux-arm64
  @kitsunekode/kunai-linux-arm64-musl
  @kitsunekode/kunai-linux-x64
  @kitsunekode/kunai-linux-x64-musl
  @kitsunekode/kunai-windows-arm64
  @kitsunekode/kunai-windows-x64
  ```

  npm cannot attach a trusted publisher to a package name that has never been
  created. If any name is absent, an owner must bootstrap it once before the
  protected workflow is allowed to publish a real release.

- Configure npm Trusted Publishing (OIDC) separately for **all nine packages**:
  - npm package settings → Trusted publishers
  - GitHub repository: `KitsuneKode/kunai`
  - Workflow path: `.github/workflows/release.yml` (workflow filename `release.yml`)
  - GitHub environment: `release-production`
- Configure the GitHub Actions environment `release-production` with required reviewers (publication waits on approval).
- Do not configure or pass `NPM_TOKEN` / `NODE_AUTH_TOKEN` in the publish job.
  Trusted publishing authenticates the npm CLI through GitHub OIDC and requires
  `permissions: id-token: write`.

Before the first protected run, and whenever ownership or trusted-publisher
settings change, preflight every package at the candidate version:

```sh
VERSION=0.3.0
for PACKAGE in \
  @kitsunekode/kunai \
  @kitsunekode/kunai-darwin-arm64 \
  @kitsunekode/kunai-darwin-x64 \
  @kitsunekode/kunai-linux-arm64 \
  @kitsunekode/kunai-linux-arm64-musl \
  @kitsunekode/kunai-linux-x64 \
  @kitsunekode/kunai-linux-x64-musl \
  @kitsunekode/kunai-windows-arm64 \
  @kitsunekode/kunai-windows-x64
do
  npm view "${PACKAGE}@${VERSION}" name version dist.integrity --json
done
```

An absent candidate version is expected for a new release. An absent package
name is different: stop before a real release unless an npm owner has created
that package and configured its trusted publisher. Authentication, permission,
network, malformed-response, and integrity errors are failures, not absence.

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
3. Builds all eight release binaries plus their deterministic archives,
   verifies the exact 18 native files listed below, and runs compiled binary
   smoke
4. Builds the eight exact-version npm platform packages and preserves their
   tarballs, then runs `bun run release:pack` to preserve the launcher as
   `.release-candidate/kunai-npm.tgz`
5. Stages the native files under an isolated `native/` directory, reverifies
   that exact 18-file directory, creates GitHub OIDC attestations for all 18
   subjects, then uploads artifact
   `kunai-release-candidate-<version>-<commit-sha>` with the preserved launcher
   and platform-package tarballs alongside it (14-day retention). Downstream
   jobs download this immutable artifact by its numeric artifact id.

The exact native directory is:

```text
kunai-linux-x64
kunai-linux-x64.tar.gz
kunai-linux-arm64
kunai-linux-arm64.tar.gz
kunai-linux-x64-musl
kunai-linux-x64-musl.tar.gz
kunai-linux-arm64-musl
kunai-linux-arm64-musl.tar.gz
kunai-darwin-x64
kunai-darwin-x64.tar.gz
kunai-darwin-arm64
kunai-darwin-arm64.tar.gz
kunai-windows-x64.exe
kunai-windows-x64.zip
kunai-windows-arm64.exe
kunai-windows-arm64.zip
SHA256SUMS
SHA256SUMS.archives
```

For the 0.3.0 compatibility bridge, legacy `SHA256SUMS` continues to hash raw
standalone binaries so already-published installers and updaters remain
functional. `SHA256SUMS.archives` hashes archives. Current installers and the
in-app updater consume the canonical archive first, then use the raw asset only
when an older release returns HTTP 404/410 for its archive metadata or asset.
Do not dispatch a release until the complete archive-consumer stack and these
protected preservation gates are green.

The blocking native matrix downloads this preserved candidate on Linux, macOS,
and Windows. Each host serves only its exact archive and both checksum
manifests from a loopback fixture, runs the checked-out production installer in
an isolated profile, verifies the published archive provenance, and executes
the installed launcher with `--version` and `--help`. It also executes the raw
candidate separately for compatibility; the installer proof cannot silently
fall back because the fixture never exposes that raw asset. The x64 and arm64
Linux runners repeat the production `install.sh` archive path inside native
Alpine containers for both musl builds, also with the raw fallback withheld.

`release:pack` is:

```sh
mkdir -p .release-candidate && ROOT="$PWD" && \
  (cd apps/cli && bun pm pack --ignore-scripts --quiet --filename "$ROOT/.release-candidate/kunai-npm.tgz")
```

### 3. Confirmation gate (still no publish)

Job **`confirmation`** waits for the candidate, installer, README-command,
live-provider, native-platform, and native-provenance gates. It downloads the
preserved candidate by artifact id, pulls the provider signoff artifact from
`provider_signoff_run_id`, verifies the downloaded `native/` directory
immediately before the confirmation boundary, verifies every native attestation
against the release workflow and candidate commit, and runs:

```sh
bun run release:confirmation:check -- \
  --version <version> \
  --commit <sha> \
  --provider-evidence artifacts/release-provider-signoff.json \
  --provider-signoff-run-id <run_id> \
  --binary-dir .release-download/native
```

Expected machine-readable `ready-for-confirmation` JSON. Nothing has been published yet.

### 4. Protected publication (no rebuild)

Job **`publish`** needs `confirmation` and declares `environment: release-production`. After approval it:

1. Downloads the preserved candidate artifact (does **not** rebuild, re-pack,
   or recompress native assets)
2. Reverifies the exact native directory and all 18 attestations, before npm
   publication, against the
   expected version, release workflow, main-branch ref, and candidate commit
3. Runs `bun run release`, whose npm publisher reconciles all eight preserved
   platform-package tarballs first and the exact-version launcher tarball last,
   refusing integrity or version skew and publishing with npm provenance
4. Retries `npm view` for the launcher and all eight platform packages until
   every exact version is visible, then performs a clean registry install and
   launcher smoke
5. Creates annotated tag `v<version>` and pushes it
6. Reverifies the same downloaded native directory and provenance again,
   immediately before creating a **draft** GitHub release (`make_latest: false`)
   with its 18 files
7. `bun run scripts/verify-github-release-assets.ts <tag> --expect-draft …`
   downloads the draft assets and verifies their bytes and attestations
8. Promotes immediately after that draft-byte verification:
   `gh release edit <tag> --draft=false --latest`
9. Proves the release is public, then downloads and verifies its bytes and
   attestations again

### 5. Metadata after public verification

Job **`metadata`** runs only after publish succeeds:

```sh
bun run scripts/set-release-status.ts <version> published <UTC-ISO>
```

Then focused release-artifact tests, `release:notes:check`, and a narrow commit/push of `.release/kunai-v<version>.json` (`chore(release): mark vX.Y.Z published`). No force-push.

## npm publication recovery

If publication stops partway through the nine-package set, rerun the same
Release workflow with the **same version**. The publisher reconciles the
preserved candidate against npm in canonical order:

- an absent version is published;
- an existing version with identical npm integrity is verified and skipped;
- an existing version with different integrity halts the release;
- all eight platform packages are reconciled before `@kitsunekode/kunai`.

Do not unpublish, overwrite, hand-increment, or rebuild a partial candidate.
The launcher stays last so users can never resolve it before its exact-version
platform packages exist. A rerun is safe only with the preserved artifacts from
the original candidate job.

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

**npm vs GitHub Release artifacts:** npm publishes the preserved
`kunai-npm.tgz` (allowlisted launcher files only). The eight archives and eight
raw standalone binaries ship only via the GitHub release — `bun run pkg:check`
fails if `dist/bin/` appears in the npm tarball.

## GitHub release tags

Prefer tag `vX.Y.Z` created by the **publish** job with the 18 required native
assets (8 archives + 8 raw binaries + 2 checksum manifests). Release notes body
comes from `.release/kunai-vX.Y.Z.md`. Avoid duplicate
`@kitsunekode/kunai@X.Y.Z` releases with empty bodies.

## Local release utilities

- `bun run changeset` → create release intent files
- `bun run version:packages` → apply pending versions + update both changelogs + staged `.release` notes
- `bun run release:pack` → write `.release-candidate/kunai-npm.tgz` (same packing path CI uses)
- `bun run release` → reconcile/publish the eight preserved platform tarballs,
  then the preserved launcher tarball last, using npm trusted publishing and
  provenance (CI publish job in practice)
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
