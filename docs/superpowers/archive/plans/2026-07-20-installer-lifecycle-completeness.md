# Installer Lifecycle Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the native lifecycle with strict versions, a versioned ownership manifest, verified local metadata, bounded downloads, read-only doctor, local rollback, and ownership-safe uninstall.

**Architecture:** Keep lifecycle mechanics inside `apps/cli/src/services/update/native-installer/`. Command runners parse/render only. Shared modules own layout, locks, transactions, metadata verification, launcher activation, download policy, rollback, diagnostics, and cleanup. Bootstrap scripts persist the same contract.

**Tech Stack:** Bun, TypeScript, Node filesystem/crypto streams, Bash, PowerShell, Docker.

## Global Constraints

- Preferred update channel remains `stable`.
- Rollback is local-only and never downloads historical versions.
- Doctor is read-only and never migrates/repairs/cleans.
- Activation follows required checksum verification.
- `--force` never deletes a live lock.
- Default uninstall preserves user config/history/cache/downloads.
- Stable persisted versions are exact `major.minor.patch`; no prerelease/build/path-like input.
- Default native download policy: 300s total, 30s no-progress, 3 attempts, 256 MiB binary, 1 MiB checksum document.
- Execute after the installer-safety plan.

---

### Task 1: Centralize strict version validation

**Files:**

- Create: `apps/cli/src/services/update/version.ts`
- Modify: latest-version, upgrade-planner, install-layout, cleanup, migration files
- Create/modify focused tests

**Interfaces:**

```ts
export type CanonicalVersion = string & { readonly __canonicalVersion: unique symbol };
export function parseCanonicalVersion(value: string): CanonicalVersion | null;
export function normalizeRequestedVersion(value: string): CanonicalVersion | null;
export function parsePublishedVersionTag(value: string | undefined): CanonicalVersion | null;
export function compareCanonicalVersions(left: CanonicalVersion, right: CanonicalVersion): number;
```

- [ ] **Step 1: Add exact grammar tests**

```ts
test.each(["0.3.0", "1.0.0", "10.20.300"])("accepts %s", (value) => {
  expect(parseCanonicalVersion(value)).toBe(value);
});

test.each(["01.2.3", "1.2.3-beta", "1.2.3+build", "../1.2.3", "1.2"])("rejects %s", (value) =>
  expect(parseCanonicalVersion(value)).toBeNull(),
);
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/unit/services/update/version.test.ts
```

- [ ] **Step 3: Implement exact parser**

Use `/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`. Filesystem path helpers validate before `join()`.

- [ ] **Step 4: Replace loose regexes and run**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/version.test.ts \
  test/unit/latest-version.test.ts \
  test/unit/services/update/native-installer/install-layout.test.ts \
  test/unit/upgrade-planner.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(update): enforce strict release versions"
```

Stage only `version.ts`, modified update/layout files, and their tests.

### Task 2: Expand and migrate the install manifest

**Files:**

- Modify: `apps/cli/src/services/update/install-manifest.ts`
- Modify every manifest consumer
- Modify: `apps/cli/test/unit/install-manifest.test.ts`

**Interfaces:**

```ts
export const INSTALL_MANIFEST_SCHEMA_VERSION = 1;
export interface InstallManifest {
  readonly schemaVersion: 1;
  readonly method: "binary" | "npm-global" | "bun-global" | "source";
  readonly observedProvenance?: string;
  readonly activeVersion: string;
  readonly previousVersion?: string;
  readonly preferredChannel: "stable";
  readonly launcherPath: string;
  readonly versionedPath?: string;
  readonly managedPaths: readonly string[];
  readonly target?: string;
  readonly artifactSha256?: string;
  readonly downloadBaseUrl: string;
  readonly installedAt: string;
  readonly updatedAt: string;
}
```

- [ ] **Step 1: Add migration and read-only inspection tests**

```ts
test("inspection reports migration without writing", async () => {
  await Bun.write(path, JSON.stringify(LEGACY_VERSIONED));
  const before = await Bun.file(path).text();
  expect(await inspectInstallManifest(dir)).toMatchObject({
    status: "loaded",
    needsMigration: true,
  });
  expect(await Bun.file(path).text()).toBe(before);
});
```

Cover flat binary, npm/Bun/source, invalid JSON, future schema, missing timestamp, invalid version, and malicious managed paths.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/unit/install-manifest.test.ts
```

- [ ] **Step 3: Implement inspect/read/write separation**

`inspectInstallManifest()` never writes. `readInstallManifest()` atomically migrates valid legacy schema. Derive native managed roots from layout; package-manager/source use `[]`. Preserve original installedAt and refresh updatedAt.

- [ ] **Step 4: Rename all consumer fields**

```text
channel -> method
version -> activeVersion
binPath -> launcherPath
versionPath -> versionedPath
dlBase -> downloadBaseUrl
```

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/install-manifest.test.ts \
  test/unit/run-uninstall.test.ts \
  test/unit/upgrade-planner.test.ts \
  test/unit/services/update/BinaryAutoUpdater.test.ts
git commit -m "feat(update): version the install ownership manifest"
```

Stage exact manifest consumers and tests only.

### Task 3: Add verified version metadata, transactions, and lock inspection

**Files:**

- Create: `native-installer/version-metadata.ts`
- Create: `native-installer/transaction.ts`
- Modify layout/lock/cleanup/index files
- Add metadata/transaction/lock tests

**Interfaces:**

```ts
export interface InstalledVersionMetadata {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly target: string;
  readonly artifactName: string;
  readonly artifactSha256: string;
  readonly sizeBytes: number;
  readonly sourceUrl: string;
  readonly verification: "release-checksum" | "legacy-unverified";
  readonly installedAt: string;
}
```

```ts
export async function verifyStoredVersion(...): Promise<
  | { readonly status: "verified"; readonly metadata: InstalledVersionMetadata }
  | { readonly status: "missing-binary" | "missing-metadata" | "invalid-metadata" |
      "untrusted-metadata" | "size-mismatch" | "checksum-mismatch"; readonly detail: string }
>;
```

- [ ] **Step 1: Add trusted/untrusted metadata tests**

```ts
test("legacy self-attestation is not rollback-verified", async () => {
  await seedMetadata({ verification: "legacy-unverified" });
  expect(await verifyStoredVersion(layout, "1.2.3")).toMatchObject({
    status: "untrusted-metadata",
  });
});
```

- [ ] **Step 2: Add live/stale lock tests**

An alive PID remains active regardless of age; read-only inspection never removes stale files.

- [ ] **Step 3: Add transaction record API**

```ts
export interface InstallTransactionRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: "install" | "upgrade" | "rollback" | "uninstall";
  readonly pid: number;
  readonly version?: string;
  readonly stagingDir?: string;
  readonly startedAt: string;
}
```

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/native-installer/version-metadata.test.ts \
  test/unit/services/update/native-installer/transaction.test.ts \
  test/unit/services/update/native-installer/version-lock.test.ts \
  test/unit/services/update/native-installer/install-layout.test.ts
git commit -m "feat(installer): record verified local version metadata"
```

### Task 4: Implement bounded streamed native downloads

**Files:**

- Create: `native-installer/download.ts`
- Modify: `native-installer/install-latest.ts`
- Modify launcher/cleanup/lock/index and `run-upgrade.ts`
- Add download/install-latest/launcher tests

**Interfaces:**

```ts
export interface DownloadPolicy {
  readonly totalDeadlineMs: number;
  readonly stallDeadlineMs: number;
  readonly maxAttempts: number;
  readonly maxBytes: number;
  readonly retryBaseDelayMs: number;
}

export async function downloadToFile(input: {
  readonly url: string;
  readonly destinationPath: string;
  readonly fetchImpl?: typeof fetch;
  readonly policy?: DownloadPolicy;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly attempts: number;
}>;
```

- [ ] **Step 1: Add deterministic timeout/size/retry tests**

Test stalled response partial cleanup, Content-Length over limit, chunked over limit, zero bytes, 404 no retry, 429/5xx retry, caller abort, and one total deadline across attempts.

- [ ] **Step 2: Add activation-preserves-old-state test**

```ts
test("checksum failure preserves launcher and manifest", async () => {
  const result = await installLatest(BAD_CHECKSUM_INPUT);
  expect(result.status).toBe("failed");
  expect(await readlink(layout.launcherPath)).toBe(previousPath);
  expect((await readInstallManifest(layout.configDir))?.activeVersion).toBe("1.0.0");
});
```

- [ ] **Step 3: Implement streamed hash/partial cleanup**

Retry only network, 408, 429, 5xx, and stall while total budget remains. Do not retry checksum, 404, invalid body, empty, or size violation.

- [ ] **Step 4: Integrate transaction order**

Validate version, resolve target, acquire lifecycle+version locks, begin transaction, download checksums/binary, verify, atomically install, write metadata, activate launcher, write manifest, finish transaction, release locks, then clean.

- [ ] **Step 5: Remove duplicate manual upgrade fetch path**

Binary upgrade uses `installLatest`; unknown ownership becomes guidance, not a second installer.

- [ ] **Step 6: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/native-installer/download.test.ts \
  test/unit/services/update/native-installer/install-latest.test.ts \
  test/unit/services/update/native-installer/launcher.test.ts \
  test/unit/self-replace.test.ts
git commit -m "feat(installer): bound verified native downloads"
```

### Task 5: Add read-only doctor text and JSON

**Files:**

- Create: `native-installer/doctor.ts`
- Create: `services/update/run-doctor.ts`
- Modify: `ui.ts`, `main.ts`, `cli-args.ts`, native index
- Add doctor/run-doctor/main-args tests

**Interfaces:**

```ts
export interface DoctorFinding {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly remediation: readonly string[];
}

export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly runningExecutable: { readonly path: string; readonly version: string };
  readonly pathCandidates: readonly {
    readonly order: number;
    readonly path: string;
    readonly winner: boolean;
    readonly observedProvenance: string;
  }[];
  readonly manifest: InstallManifestInspection;
  readonly findings: readonly DoctorFinding[];
  // launcher, versions, locks, transactions, platform, dependencies
}
```

- [ ] **Step 1: Extract non-persisting capability probe**

`probeCapabilities()` reads availability; `checkDeps()` retains notice persistence. Doctor calls only the probe.

- [ ] **Step 2: Add read-only tree snapshot test**

```ts
test("doctor does not migrate or clean", async () => {
  await seedLegacyManifestAndStaleState();
  const before = await snapshotTree(root);
  await buildDoctorReport({ layout, now: () => FIXED_DATE });
  expect(await snapshotTree(root)).toEqual(before);
});
```

- [ ] **Step 3: Add text/JSON equivalence**

`kunai doctor --json` prints exactly the report. Text includes executable, PATH candidates, manifest/provenance, versions/checksums, locks/transactions, platform, dependencies, and remediations. Exit 1 only for errors.

- [ ] **Step 4: Wire maintenance command before shell bootstrap**

```ts
if (argv[0] === "doctor") {
  process.exit(await runDoctor({ json: argv.includes("--json") }));
}
```

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/native-installer/doctor.test.ts \
  test/unit/run-doctor.test.ts \
  test/unit/main-args.test.ts
git commit -m "feat(update): add read-only doctor text and json"
```

### Task 6: Implement local verified rollback

**Files:**

- Create: `native-installer/rollback.ts`
- Create: `services/update/run-rollback.ts`
- Modify cleanup/index/main/help files
- Add rollback command tests

**Interfaces:**

```ts
export interface RollbackCandidate {
  readonly version: string;
  readonly versionPath: string;
  readonly target: string;
  readonly artifactSha256: string;
  readonly sizeBytes: number;
  readonly installedAt: string;
  readonly active: boolean;
  readonly previous: boolean;
  readonly lockStatus: "missing" | "stale";
}
```

- [ ] **Step 1: Add candidate/filter/read-only plan tests**

Only trusted checksum-verified local versions appear; planning does not mutate state.

- [ ] **Step 2: Add activation/refusal tests**

Default targets `previousVersion`; explicit `--to` validates strictly; active lock/corrupt/missing/non-native candidates refuse without change; dry-run performs no write.

- [ ] **Step 3: Implement locked re-verification and swap**

Reverify inside lifecycle+version locks, update launcher, then manifest with active/previous swapped. If manifest write fails, restore the old launcher.

- [ ] **Step 4: Wire command/help and run**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/native-installer/rollback.test.ts \
  test/unit/run-rollback.test.ts \
  test/unit/main-args.test.ts
git commit -m "feat(update): add verified local rollback"
```

### Task 7: Complete ownership-safe native uninstall

**Files:**

- Create: `native-installer/native-uninstall.ts`
- Modify: `run-uninstall.ts`, launcher, lock, index
- Add uninstall/launcher tests

**Interfaces:**

```ts
export interface NativeUninstallResult {
  readonly status: "removed" | "blocked" | "partial";
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
  readonly failed: readonly { path: string; error: string }[];
}
```

- [ ] **Step 1: Add residue/preservation tests**

Seed versions, staging, locks, transactions, launcher copy-asides, config/history/cache/downloads. Default uninstall removes owned lifecycle state and preserves user data.

- [ ] **Step 2: Add refusal tests**

Active locks/transactions and unmanaged launcher block without mutation. Windows launcher ownership requires checksum match.

- [ ] **Step 3: Implement ordered cleanup**

Acquire lifecycle lock; verify ownership; remove launcher and owned transaction artifacts; versions/staging/transactions/stale locks; manifest last. Partial failure keeps manifest. `--purge` reports each user root; external/custom download directories remain preserved.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/native-installer/native-uninstall.test.ts \
  test/unit/services/update/native-installer/launcher.test.ts \
  test/unit/run-uninstall.test.ts
git commit -m "fix(update): complete native uninstall cleanup"
```

### Task 8: Align bootstrap scripts with the lifecycle contract

**Files:**

- Modify: `install.sh`, `install.ps1`
- Modify installer harness/tests and Docker smoke

- [ ] **Step 1: Extend fixture routes**

Support status, headers, failures-before-success, and delayed chunks for retry/stall tests.

- [ ] **Step 2: Add strict version, bounded download, and preservation tests**

For Bash and PowerShell: reject traversal/prerelease/leading zero before directories; retry 503 then succeed; do not retry 404; reject oversized and stalled bodies; remove partials; preserve old launcher/manifest.

- [ ] **Step 3: Implement compatible bootstrap transaction**

Scripts validate version, create unique staging, lock/transaction records, bounded download, verify checksum, write version metadata, atomically activate launcher, write schema-1 manifest, clean handled state.

Bash curl uses `--connect-timeout 15`, remaining `--max-time`, `--speed-time 30`, `--speed-limit 1`, and `--max-filesize`.

PowerShell uses `HttpClient` with `ResponseHeadersRead`, cancellation, streamed byte count, and per-read no-progress deadline.

- [ ] **Step 4: Extend Docker lifecycle**

After upgrade, run doctor JSON, rollback list/dry-run/default/explicit, seed owned residue, uninstall, and assert user config/history/external download survive.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/integration/install-scripts.test.ts \
  test/integration/install-scripts-pwsh.test.ts
KUNAI_INSTALLER_DOCKER=1 bun run test:installer:docker
git add install.sh install.ps1 \
  apps/cli/test/integration/helpers/installer-script-harness.ts \
  apps/cli/test/integration/install-scripts.test.ts \
  apps/cli/test/integration/install-scripts-pwsh.test.ts \
  apps/cli/test/docker/native-installer/smoke.sh
git commit -m "feat(installer): align bootstrappers with lifecycle contract"
```

## Slice Verification

```bash
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
bun run pkg:check
KUNAI_INSTALLER_DOCKER=1 bun run test:installer:docker
```

Expected: all pass; doctor is read-only, rollback is local/verified, uninstall preserves user data, and the unrelated release/reference paths remain outside commits.
