# Release Truth and Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make changelogs, npm packaging, staged release metadata, GitHub assets, and publication workflow agree before Kunai 0.3.0 can be promoted.

**Architecture:** Treat release creation as a staged state machine. Versioning creates reviewed staged metadata; deterministic jobs build the exact npm tarball and eight binaries; protected approval is required before publishing preserved artifacts; release metadata becomes published only after npm, tag, and GitHub assets agree.

**Tech Stack:** Bun, TypeScript, Changesets, npm, Next.js docs, GitHub Actions, GitHub CLI.

## Global Constraints

- Target version is `0.3.0`.
- Public latest remains `0.2.5` until 0.3.0 is verified and promoted.
- 0.2.6 is unpublished staging, not release history.
- Release asset contract is exactly eight binaries plus `SHA256SUMS`.
- `npm pack --ignore-scripts` is a contents check, not lifecycle proof.
- Candidate artifacts are built before publication and are not rebuilt by publish jobs.
- Publication requires protected-environment approval.
- Preserve and separately land the existing `scripts/generate-release-notes.ts` change before other tasks edit that file.
- Never stage `docs/installer-reference/`.

---

### Task 0: Finish the existing release-note asset-preservation change

**Files:**

- Modify: `scripts/generate-release-notes.ts` (existing uncommitted change)
- Modify: `apps/cli/test/unit/scripts/generate-release-notes.test.ts`

**Interfaces:**

- Consumes: existing `.release/kunai-vX.Y.Z.json`
- Produces: regenerated artifact preserving only a pre-existing non-empty `assets` array

- [ ] **Step 1: Add preservation tests**

```ts
test("regeneration preserves existing verified assets", async () => {
  await Bun.write(
    artifactPath,
    JSON.stringify({
      ...BASE_ARTIFACT,
      assets: [{ name: "kunai-linux-x64", sha256: "a".repeat(64) }],
    }),
  );

  await writeArtifact({ path: artifactPath, artifact: NEXT_ARTIFACT });

  expect(await Bun.file(artifactPath).json()).toMatchObject({
    assets: [{ name: "kunai-linux-x64", sha256: "a".repeat(64) }],
  });
});

test("malformed existing JSON falls back without crashing", async () => {
  await Bun.write(artifactPath, "{not-json");
  await expect(
    writeArtifact({ path: artifactPath, artifact: NEXT_ARTIFACT }),
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run focused tests**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/generate-release-notes.test.ts \
  test/unit/scripts/release-binary-checksums.test.ts
```

Expected: tests expose any missing malformed-file handling or asset preservation.

- [ ] **Step 3: Simplify the existing write path without changing ownership**

Read existing assets once, then pass them into serialization. Do not author or validate new checksums in this task. Continue ignoring assets during freshness comparison.

- [ ] **Step 4: Re-run tests and commit only these files**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/generate-release-notes.test.ts \
  test/unit/scripts/release-binary-checksums.test.ts
git add scripts/generate-release-notes.ts \
  apps/cli/test/unit/scripts/generate-release-notes.test.ts
git commit -m "fix(release): preserve verified assets when regenerating notes"
```

### Task 1: Parse major, minor, patch, and multi-entry changelogs

**Files:**

- Modify: `scripts/release-changelog.ts`
- Modify: `apps/cli/test/unit/scripts/release-changelog.test.ts`

**Interfaces:**

```ts
export type ChangelogChangeKind = "major" | "minor" | "patch";
export interface ChangelogChange {
  readonly kind: ChangelogChangeKind;
  readonly body: string;
}
export function parseChangesetEntries(rawBody: string): readonly ChangelogChange[];
```

- [ ] **Step 1: Add a minor/mixed fixture**

```ts
test("parses minor and patch groups without wrapper headings", () => {
  const entry = parseTopCliChangelogEntry(`
## 0.3.0

### Minor Changes

- abc123: Add queue recovery.

  #### Highlights

  Exact queue acknowledgement.

### Patch Changes

- def456: Fix installer ownership.
`);

  expect(entry?.body).toContain("Add queue recovery");
  expect(entry?.body).toContain("### Highlights");
  expect(entry?.body).toContain("Fix installer ownership");
  expect(entry?.body).not.toContain("### Minor Changes");
  expect(entry?.body).not.toContain("### Patch Changes");
});
```

Also add major, multiple entries, HTML comment, and human-summary fixtures.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/unit/scripts/release-changelog.test.ts
```

Expected: minor/major wrappers leak or parsing fails.

- [ ] **Step 3: Implement ordered group parsing**

Recognize `### Major Changes`, `### Minor Changes`, and `### Patch Changes`; split top-level entries; preserve nested prose; remove attribution prefixes, commit links, and HTML comments.

- [ ] **Step 4: Verify consumers and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/release-changelog.test.ts \
  test/unit/scripts/generate-release-notes.test.ts
bun run guard
bun run release:notes:check
git add scripts/release-changelog.ts \
  apps/cli/test/unit/scripts/release-changelog.test.ts
git commit -m "fix(release): parse all changeset release groups"
```

### Task 2: Bundle and exercise the npm postinstall hook

**Files:**

- Modify: `apps/cli/scripts/build-shared.ts`
- Modify: `apps/cli/scripts/build.ts`
- Modify: `apps/cli/scripts/verify-npm-pack.ts`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/test/unit/scripts/verify-npm-pack.test.ts`
- Create: `apps/cli/test/integration/npm-global-install.test.ts`
- Modify: `package.json`
- Modify: `turbo.json`
- Create: `.changeset/repair-release-truth.md`

**Interfaces:**

```ts
export const POSTINSTALL_ENTRY = "scripts/postinstall.ts";
export const NPM_POSTINSTALL_OUT = "dist/postinstall.js";
export function npmPostinstallBuildOptions(root: string): BunBuildOptions;
```

- [ ] **Step 1: Require the postinstall artifact in pack tests**

```ts
test("requires the bundled postinstall file", () => {
  expect(() => assertNpmPackContents(["dist/kunai.js", "package.json"])).toThrow(
    "dist/postinstall.js",
  );
});
```

- [ ] **Step 2: Add the real isolated global-install test**

The test must create isolated `HOME`, XDG directories, npm cache, and npm prefix; run `npm pack --ignore-scripts`; install the tarball without `--ignore-scripts`; assert `kunai --version`, manifest registration, `kunai upgrade --check`, and npm-routed uninstall.

Core assertion:

```ts
expect(await Bun.file(join(configHome, "kunai/install.json")).json()).toMatchObject({
  channel: "npm-global",
  version: packageJson.version,
});
```

- [ ] **Step 3: Verify current failure**

```bash
bun run build
bun run pkg:check
bun run test:npm-global-install
```

Expected: package lifecycle fails because the declared script is absent from the tarball.

- [ ] **Step 4: Bundle `scripts/postinstall.ts`**

Build `dist/postinstall.js` as ESM with all imports bundled. Change package metadata to:

```json
"files": [
  "dist/kunai.js",
  "dist/postinstall.js",
  "dist/assets/**",
  "README.md",
  "LICENSE"
],
"scripts": {
  "postinstall": "bun dist/postinstall.js"
}
```

- [ ] **Step 5: Add scripts and Changeset**

```json
"test:npm-global-install": "bun run --cwd apps/cli test:npm-global-install"
```

Changeset body:

```markdown
---
"@kitsunekode/kunai": patch
---

Ship the npm postinstall registration hook in the published tarball and verify a clean global install, update check, and package-manager uninstall.
```

- [ ] **Step 6: Run and commit**

```bash
bun run build
bun run pkg:check
bun run test:npm-global-install
bun run --cwd apps/cli test:file -- test/unit/scripts/verify-npm-pack.test.ts
git add apps/cli/scripts/build-shared.ts \
  apps/cli/scripts/build.ts \
  apps/cli/scripts/verify-npm-pack.ts \
  apps/cli/package.json \
  apps/cli/test/unit/scripts/verify-npm-pack.test.ts \
  apps/cli/test/integration/npm-global-install.test.ts \
  package.json turbo.json .changeset/repair-release-truth.md
git commit -m "fix(package): ship and exercise npm postinstall"
```

### Task 3: Add staged, published, and withdrawn release metadata

**Files:**

- Create: `scripts/release-artifact.ts`
- Create: `scripts/set-release-status.ts`
- Modify: `scripts/generate-release-notes.ts`
- Modify: `scripts/release-binary-checksums.ts`
- Create: `apps/cli/test/unit/scripts/release-artifact.test.ts`
- Modify: `apps/cli/test/unit/scripts/generate-release-notes.test.ts`

**Interfaces:**

```ts
export const RELEASE_ARTIFACT_SCHEMA_VERSION = 2;
export type ReleasePublicationStatus = "staged" | "published" | "withdrawn";

export interface ReleaseNotesArtifact {
  readonly schemaVersion: 2;
  readonly status: ReleasePublicationStatus;
  readonly publishedAt: string | null;
  readonly packageName: string;
  readonly version: string;
  readonly tag: string;
  readonly title: string;
  readonly date: string | null;
  readonly summary: string;
  readonly sections: readonly ReleaseNotesSection[];
  readonly changelogBody: string;
  readonly install: ReleaseInstallCommands;
  readonly assets?: readonly ReleaseBinaryChecksum[];
}
```

- [ ] **Step 1: Add transition tests**

```ts
test("publishes a staged artifact and retains assets", () => {
  expect(
    transitionReleaseStatus(STAGED_WITH_ASSETS, "published", "2026-07-20T12:00:00Z"),
  ).toMatchObject({
    status: "published",
    publishedAt: "2026-07-20T12:00:00Z",
    assets: STAGED_WITH_ASSETS.assets,
  });
});

test("published artifacts cannot regress to staged", () => {
  expect(() => transitionReleaseStatus(PUBLISHED, "staged")).toThrow(
    "published release cannot return to staged",
  );
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/release-artifact.test.ts \
  test/unit/scripts/generate-release-notes.test.ts
```

- [ ] **Step 3: Implement schema and atomic status CLI**

New generated artifacts default to `status: "staged"` and `publishedAt: null`. `set-release-status.ts` updates one exact `.release/kunai-vX.Y.Z.json` and preserves assets.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/release-artifact.test.ts \
  test/unit/scripts/generate-release-notes.test.ts \
  test/unit/scripts/release-binary-checksums.test.ts
git add scripts/release-artifact.ts scripts/set-release-status.ts \
  scripts/generate-release-notes.ts scripts/release-binary-checksums.ts \
  apps/cli/test/unit/scripts/release-artifact.test.ts \
  apps/cli/test/unit/scripts/generate-release-notes.test.ts \
  apps/cli/test/unit/scripts/release-binary-checksums.test.ts
git commit -m "feat(release): model staged and published artifacts"
```

### Task 4: Keep staged releases out of public history

**Files:**

- Modify: `.release/kunai-v0.2.5.json`
- Modify: `.release/kunai-v0.2.6.json`
- Modify: `apps/docs/lib/release-notes.ts`
- Modify: `apps/docs/components/releases/release-timeline.tsx`
- Modify: `apps/docs/components/releases/release-detail.tsx`
- Modify: `apps/docs/components/releases/release-install-panel.tsx`
- Modify: `apps/docs/app/llms.txt/route.ts`
- Modify: `apps/docs/test/release-notes.test.ts`

- [ ] **Step 1: Migrate fixtures**

Mark 0.2.5 published with its real date. Mark 0.2.6 staged, set `publishedAt: null`, and remove its unverified `assets`.

- [ ] **Step 2: Add docs classification tests**

```ts
test("latest public release ignores staged 0.2.6", () => {
  expect(latestReleaseNotesArtifact()?.version).toBe("0.2.5");
});

test("staged releases have no GitHub URL or visible assets", () => {
  expect(githubReleaseUrl(STAGED_026)).toBeNull();
  expect(releaseAssetsForDisplay(STAGED_026)).toEqual([]);
});
```

- [ ] **Step 3: Implement explicit filters**

```ts
export function publishedReleaseNotesArtifacts(): readonly ReleaseNotesArtifact[];
export function latestReleaseNotesArtifact(): ReleaseNotesArtifact | null;
export function githubReleaseUrl(release: ReleaseNotesArtifact): string | null;
```

Timeline shows staged entries separately as upcoming, never latest/history. Staged details show no versioned npm/Bun commands, release link, or checksums.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/docs test
bun run --cwd apps/docs typecheck:app
bun run --cwd apps/docs build:app
bun run release:notes:check
git add .release/kunai-v0.2.5.json .release/kunai-v0.2.6.json \
  apps/docs/lib/release-notes.ts \
  apps/docs/components/releases/release-timeline.tsx \
  apps/docs/components/releases/release-detail.tsx \
  apps/docs/components/releases/release-install-panel.tsx \
  apps/docs/app/llms.txt/route.ts apps/docs/test/release-notes.test.ts
git commit -m "fix(docs): keep staged releases out of public history"
```

### Task 5: Verify exact local and remote release asset sets

**Files:**

- Modify: `scripts/release-asset-contract.ts`
- Create: `scripts/verify-release-artifact-directory.ts`
- Modify: `scripts/verify-github-release-assets.ts`
- Modify: `apps/cli/scripts/verify-release-binaries.sh`
- Modify: `apps/cli/test/unit/scripts/distribution-contract.test.ts`
- Modify: `apps/cli/test/integration/compiled-binary-smoke.test.ts`

**Interfaces:**

```ts
export interface ReleaseAssetDescriptor {
  readonly name: string;
  readonly size: number;
}
export function assertCompleteReleaseAssetSet(assets: readonly ReleaseAssetDescriptor[]): void;
export async function verifyReleaseArtifactDirectory(input: {
  readonly directory: string;
  readonly expectedVersion: string;
}): Promise<void>;
```

- [ ] **Step 1: Add missing/extra/empty/checksum tests**

```ts
test("rejects a zero-byte required asset", () => {
  expect(() =>
    assertCompleteReleaseAssetSet(
      requiredAssetNames.map((name) => ({ name, size: name === "kunai-linux-x64" ? 0 : 1 })),
    ),
  ).toThrow("kunai-linux-x64");
});
```

- [ ] **Step 2: Implement exact nine-file verification**

Reject missing, duplicate, unexpected, and zero-byte files. Parse `SHA256SUMS`, require exactly eight rows, recompute every hash, and run version/help on runnable Linux x64.

- [ ] **Step 3: Extend the GitHub verifier**

Support:

```bash
bun run scripts/verify-github-release-assets.ts v0.3.0 \
  --expect-draft --expected-version 0.3.0
```

Download assets into a temporary directory, invoke local verification, and clean up.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- test/unit/scripts/distribution-contract.test.ts
bun run build:binaries
bash apps/cli/scripts/verify-release-binaries.sh
git add scripts/release-asset-contract.ts \
  scripts/verify-release-artifact-directory.ts \
  scripts/verify-github-release-assets.ts \
  apps/cli/scripts/verify-release-binaries.sh \
  apps/cli/test/unit/scripts/distribution-contract.test.ts \
  apps/cli/test/integration/compiled-binary-smoke.test.ts
git commit -m "fix(release): verify complete release artifact sets"
```

### Task 6: Build preserved candidate artifacts before publication

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/release-guard.yml`
- Modify: `apps/cli/test/unit/scripts/distribution-contract.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add workflow contract assertions**

Tests must prove:

- push flow has no publish command;
- binaries build before npm publish;
- candidate artifacts upload before publication;
- publication downloads the preserved tarball/binaries;
- GitHub release starts as draft;
- draft verification precedes public promotion;
- metadata publication follows public verification.

- [ ] **Step 2: Split workflow event behavior**

Push to main only opens/updates the Changesets version PR. `workflow_dispatch` accepts exact `version` and builds the candidate.

- [ ] **Step 3: Add candidate job**

Order: version check, full CI, build, package check, real npm global install, release guards, all binary builds, local artifact verification, compiled smoke, npm tarball creation, artifact upload.

- [ ] **Step 4: Add protected publication job**

Declare:

```yaml
environment: release-production
```

Download and reverify candidate artifacts; publish the preserved npm tarball; verify npm; create the canonical tag; create a draft release; upload assets; verify draft; promote latest; verify public release.

Do not configure or approve the protected environment during implementation.

- [ ] **Step 5: Add post-release metadata job**

After public verification, run `set-release-status.ts`, tests, and open/push a narrow metadata update without force-pushing.

- [ ] **Step 6: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/distribution-contract.test.ts \
  test/unit/scripts/ci-bootstrap-contract.test.ts
bun run guard
bun run release:notes:check
bun run verify:build-pipeline
git add .github/workflows/release.yml \
  .github/workflows/release-guard.yml \
  apps/cli/test/unit/scripts/distribution-contract.test.ts package.json
git commit -m "ci(release): build verified artifacts before publication"
```

### Task 7: Document the staged promotion workflow

**Files:**

- Modify: `RELEASING.md`
- Modify: `PACKAGING.md`
- Modify: `docs/developer/release-checklist.mdx`

- [ ] **Step 1: Document exact states and commands**

Cover version PR outputs, staged semantics, manual candidate dispatch, protected approval, preserved tarball publication, draft release verification, public promotion, and metadata recovery.

- [ ] **Step 2: Run docs gates**

```bash
bun run fmt
bun run --cwd apps/docs test
bun run --cwd apps/docs build:app
```

- [ ] **Step 3: Commit**

```bash
git add RELEASING.md PACKAGING.md docs/developer/release-checklist.mdx
git commit -m "docs(release): document staged promotion workflow"
```

### Task 8: Review the generated 0.3.0 version PR as one unit

**Files generated/reviewed:**

- `apps/cli/package.json`
- `apps/cli/CHANGELOG.md`
- `CHANGELOG.md`
- `.release/kunai-v0.3.0.json`
- `.release/kunai-v0.3.0.md`

- [ ] **Step 1: Run version generation in the Changesets version PR**

```bash
bun run version:packages
```

- [ ] **Step 2: Inspect the exact output**

```bash
git diff -- apps/cli/package.json apps/cli/CHANGELOG.md CHANGELOG.md .release .changeset
```

Verify exact version `0.3.0`, no wrapper headings/attribution/comments, schema 2, staged status, null publishedAt, and equivalent Markdown/JSON human copy.

- [ ] **Step 3: Run guards**

```bash
bun run guard
bun run release:notes:check
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/release-changelog.test.ts \
  test/unit/scripts/generate-release-notes.test.ts
```

Expected: all pass. Allow Changesets automation to author `chore: version packages`.

## Slice Verification

```bash
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
bun run pkg:check
bun run test:npm-global-install
bun run guard
bun run release:notes:check
bun run verify:build-pipeline
bun run build:binaries
bash apps/cli/scripts/verify-release-binaries.sh
bun run --cwd apps/docs test
bun run --cwd apps/docs build:app
```

Expected: all pass; no publication, tag, or public promotion occurs during this slice.
