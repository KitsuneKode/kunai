import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import rootPackage from "../../../../../package.json";
import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertCompleteReleaseAssetSet,
  assertRequiredReleaseAssets,
} from "../../../../../scripts/release-asset-contract";
import { shouldWriteReleaseChecksums } from "../../../../../scripts/release-binary-checksums";
import { assertExpectedReleaseState } from "../../../../../scripts/verify-github-release-assets";
import { verifyReleaseArtifactDirectory } from "../../../../../scripts/verify-release-artifact-directory";
import { buildReleaseArchives } from "../../../scripts/build-release-archives";
import { buildNpmPublishManifest } from "../../../scripts/write-npm-publish-manifest";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");
const requiredAssetNames = REQUIRED_RELEASE_ASSET_NAMES;
const requiredBinaryNames = RELEASE_BINARY_TARGETS.map((t) => t.out).sort();
const requiredArchiveNames = RELEASE_BINARY_TARGETS.map((t) => t.archiveName).sort();

function writeCompleteReleaseFixture(directory: string): void {
  for (const name of requiredBinaryNames) {
    writeFileSync(join(directory, name), `payload:${name}\n`);
  }
  buildReleaseArchives(directory);
}

function completeSizedAssets(size = 1) {
  return requiredAssetNames.map((name) => ({ name, size }));
}

describe("distribution release-asset contract", () => {
  test("requires the exact 0.3.0 bridge set of archives, raw binaries, and manifests", () => {
    expect([...REQUIRED_RELEASE_ASSET_NAMES]).toEqual(
      [...requiredBinaryNames, ...requiredArchiveNames, "SHA256SUMS", "SHA256SUMS.archives"].sort(),
    );
    expect(REQUIRED_RELEASE_ASSET_NAMES).toHaveLength(18);
  });

  test("assertRequiredReleaseAssets accepts a complete set and rejects gaps", () => {
    expect(() => assertRequiredReleaseAssets(REQUIRED_RELEASE_ASSET_NAMES)).not.toThrow();
    expect(() => assertRequiredReleaseAssets(["SHA256SUMS", "SHA256SUMS.archives"])).toThrow(
      /missing/,
    );
  });

  test("assertCompleteReleaseAssetSet accepts a complete non-empty set", () => {
    expect(() => assertCompleteReleaseAssetSet(completeSizedAssets())).not.toThrow();
  });

  test("rejects a zero-byte required asset", () => {
    expect(() =>
      assertCompleteReleaseAssetSet(
        requiredAssetNames.map((name) => ({ name, size: name === "kunai-linux-x64" ? 0 : 1 })),
      ),
    ).toThrow("kunai-linux-x64");
  });

  test("rejects required assets that exceed their target size budgets", () => {
    const archive = RELEASE_BINARY_TARGETS[0]!;
    expect(() =>
      assertCompleteReleaseAssetSet(
        completeSizedAssets().map((asset) =>
          asset.name === archive.archiveName
            ? { ...asset, size: archive.maxArchiveBytes + 1 }
            : asset,
        ),
      ),
    ).toThrow(/size budget.*kunai-linux-x64\.tar\.gz/i);
    expect(() =>
      assertCompleteReleaseAssetSet(
        completeSizedAssets().map((asset) =>
          asset.name === archive.out ? { ...asset, size: archive.maxBinaryBytes + 1 } : asset,
        ),
      ),
    ).toThrow(/size budget.*kunai-linux-x64/i);
  });

  test("rejects a missing required asset", () => {
    expect(() =>
      assertCompleteReleaseAssetSet(
        completeSizedAssets().filter((asset) => asset.name !== "SHA256SUMS"),
      ),
    ).toThrow(/missing/);
  });

  test("rejects an unexpected asset", () => {
    expect(() =>
      assertCompleteReleaseAssetSet([...completeSizedAssets(), { name: "extra.bin", size: 1 }]),
    ).toThrow(/unexpected/);
  });

  test("rejects a duplicate asset name", () => {
    expect(() =>
      assertCompleteReleaseAssetSet([
        ...completeSizedAssets(),
        { name: "kunai-linux-x64", size: 1 },
      ]),
    ).toThrow(/duplicate/);
  });

  test("release.yml uploads every required asset and fails on unmatched files", () => {
    const release = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
    expect(release).toContain("fail_on_unmatched_files: true");
    for (const name of REQUIRED_RELEASE_ASSET_NAMES) {
      expect(release).toContain(`apps/cli/dist/bin/${name}`);
    }
    expect(release).toContain("verify-github-release-assets.ts");
  });

  test("build-binaries.yml errors when artifact files are missing", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/build-binaries.yml"), "utf8");
    expect(workflow).toMatch(/if-no-files-found:\s*error/);
    for (const name of REQUIRED_RELEASE_ASSET_NAMES) {
      expect(workflow).toContain(`apps/cli/dist/bin/${name}`);
    }
  });

  test("build-binaries.yml verifies the exact directory immediately before upload", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/build-binaries.yml"), "utf8");
    const upload = workflow.indexOf("- name: Upload binaries artifact");
    const exactVerify = workflow.lastIndexOf("verify-release-artifact-directory.ts", upload);

    expect(exactVerify).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(exactVerify);
    expect(workflow.slice(exactVerify, upload)).not.toContain("- name:");
  });

  test("host and installer-matrix raw-binary checks preserve SHA256SUMS compatibility", () => {
    const verifier = readFileSync(
      join(REPO_ROOT, "apps/cli/scripts/verify-host-binary.sh"),
      "utf8",
    );
    const installerMatrix = readFileSync(
      join(REPO_ROOT, ".github/workflows/installer-matrix.yml"),
      "utf8",
    );
    expect(verifier).toContain("verify_checksums SHA256SUMS >/dev/null");
    expect(verifier).not.toContain("verify_checksums SHA256SUMS.archives");
    expect(installerMatrix).toContain("apps/cli/dist/bin/SHA256SUMS");
  });
});

/** Extract a top-level GitHub Actions job block (`  jobId:`) from workflow YAML. */
function extractWorkflowJob(yaml: string, jobId: string): string {
  const header = new RegExp(`^  ${jobId}:\\s*$`, "m");
  const match = header.exec(yaml);
  if (!match || match.index === undefined) {
    throw new Error(`job "${jobId}" not found in workflow`);
  }
  const start = match.index;
  const after = yaml.slice(start + match[0].length);
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(after);
  const end = nextJob ? start + match[0].length + (nextJob.index ?? 0) : yaml.length;
  return yaml.slice(start, end);
}

describe("release workflow candidate-before-publication contract", () => {
  const release = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
  const publisher = readFileSync(join(REPO_ROOT, "scripts/publish-npm-release.ts"), "utf8");
  const versionPr = () => extractWorkflowJob(release, "version-pr");
  const candidate = () => extractWorkflowJob(release, "candidate");
  const nativeProvenanceGate = () => extractWorkflowJob(release, "native-provenance-gate");
  const nativeSmoke = () => extractWorkflowJob(release, "native-smoke");
  const readmeCommandsGate = () => extractWorkflowJob(release, "readme-commands-gate");
  const confirmation = () => extractWorkflowJob(release, "confirmation");
  const publish = () => extractWorkflowJob(release, "publish");
  const metadata = () => extractWorkflowJob(release, "metadata");

  test("push flow has no publish command", () => {
    expect(release).toMatch(/workflow_dispatch:/);
    expect(release).toMatch(/inputs:[\s\S]*version:/);
    const pushJob = versionPr();
    expect(pushJob).toMatch(/if:\s*github\.event_name\s*==\s*'push'/);
    expect(pushJob).toContain("changesets/action");
    expect(pushJob).not.toMatch(/^\s*publish:\s*/m);
    expect(pushJob).not.toContain("bun publish");
    expect(pushJob).not.toContain("changeset publish");
    expect(pushJob).not.toContain("bun run release");
  });

  // The publish step is `bun run release` (scripts/publish-npm-release.ts),
  // which publishes the platform packages before the launcher. Match either
  // spelling so the contract tracks "a publish happens after the binaries are
  // built" rather than one exact command string.
  // The lookahead matters: the candidate job legitimately runs `release:pack`
  // and `release:notes:check`, and a plain \b would match both and make this
  // assert the opposite of what it means.
  const PUBLISH_STEP = /bun publish|bun run release(?![:\w-])/;

  test("binaries build before npm publish", () => {
    const cand = candidate();
    const pub = publish();
    expect(cand).toContain("build:binaries");
    expect(cand).not.toMatch(PUBLISH_STEP);
    expect(pub).toMatch(PUBLISH_STEP);
    const binaryBuildIdx = release.indexOf("build:binaries");
    const npmPublishIdx = release.search(PUBLISH_STEP);
    expect(binaryBuildIdx).toBeGreaterThanOrEqual(0);
    expect(npmPublishIdx).toBeGreaterThan(binaryBuildIdx);
  });

  // The launcher pins all 8 platform packages as exact-version
  // optionalDependencies, so publishing it alone ships a CLI with no binary.
  test("platform packages are built, preserved, and published with the launcher", () => {
    const cand = candidate();
    const pub = publish();
    expect(cand).toContain("build:npm-platform");
    expect(cand).toContain("npm-platform");
    expect(pub).toContain("npm-platform");
    // publish-npm-release.ts is what enforces platform-packages-before-launcher
    // and refuses on version skew; a bare tarball publish would not.
    expect(pub).toContain("bun run release");
    expect(release.indexOf("build:npm-platform")).toBeLessThan(release.search(PUBLISH_STEP));
  });

  test("candidate artifacts upload before publication", () => {
    const cand = candidate();
    const pub = publish();
    expect(cand).toContain("upload-artifact");
    expect(cand).toMatch(/bun pm pack|release:pack/);
    expect(pub).toContain("download-artifact");
    expect(release.indexOf("upload-artifact")).toBeLessThan(release.indexOf("download-artifact"));
  });

  test("candidate isolates and verifies the exact native payload immediately before upload", () => {
    const cand = candidate();
    const stage = cand.indexOf("Stage candidate upload directory");
    const exactVerify = cand.indexOf("verify-release-artifact-directory.ts", stage);
    const attestStep = cand.indexOf("- name: Attest exact native candidate", exactVerify);
    const attest = cand.indexOf("actions/attest@", attestStep);
    const upload = cand.indexOf("- name: Upload candidate artifacts");

    expect(cand).toContain(".candidate-upload/native");
    expect(stage).toBeGreaterThanOrEqual(0);
    expect(exactVerify).toBeGreaterThan(stage);
    expect(attestStep).toBeGreaterThan(exactVerify);
    expect(attest).toBeGreaterThan(attestStep);
    expect(upload).toBeGreaterThan(attest);
    expect(cand.slice(exactVerify, attestStep)).not.toContain("- name:");
    expect(cand).toContain(".candidate-upload/native/SHA256SUMS");
  });

  test("candidate attests the exact native payload with narrowly scoped OIDC permissions", () => {
    const cand = candidate();
    expect(release).toContain('- "scripts/verify-native-attestations.ts"');
    expect(cand).toMatch(
      /permissions:[\s\S]*contents:\s*read[\s\S]*id-token:\s*write[\s\S]*attestations:\s*write[\s\S]*artifact-metadata:\s*write/,
    );
    expect(cand).toContain(
      "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # actions/attest@v4",
    );
    expect(cand).toContain("subject-path: .candidate-upload/native/*");
  });

  test("downloaded native candidates are provenance-gated before any execution job", () => {
    const cand = candidate();
    const provenance = nativeProvenanceGate();
    expect(cand).toContain("id: upload-candidate");
    expect(cand).toContain(
      "candidate_artifact_id: ${{ steps.upload-candidate.outputs.artifact-id }}",
    );
    expect(provenance).toMatch(/needs:\s*candidate/);
    expect(provenance).toMatch(/permissions:[\s\S]*contents:\s*read[\s\S]*attestations:\s*read/);
    expect(provenance).toContain(
      "artifact-ids: ${{ needs.candidate.outputs.candidate_artifact_id }}",
    );
    expect(provenance).toContain('merge-multiple: "true"');
    expect(provenance).toContain("verify-release-artifact-directory.ts");
    expect(provenance).toContain("verify-native-attestations.ts");
    expect(provenance).toContain('--source-digest "${GITHUB_SHA}"');

    for (const executionJob of [nativeSmoke(), readmeCommandsGate()]) {
      expect(executionJob).toMatch(/needs:\s*\[candidate, native-provenance-gate\]/);
      expect(executionJob).toMatch(/permissions:\s*\n\s+contents:\s*read/);
      expect(executionJob.indexOf("download-artifact")).toBeGreaterThanOrEqual(0);
      expect(executionJob).toContain(
        "artifact-ids: ${{ needs.candidate.outputs.candidate_artifact_id }}",
      );
      expect(executionJob).toContain('merge-multiple: "true"');
    }

    const smoke = nativeSmoke();
    expect(smoke.indexOf("verify-release-artifact-directory.ts")).toBeLessThan(
      smoke.indexOf("Exercise exact preserved archive"),
    );
    const readme = readmeCommandsGate();
    expect(readme.indexOf("verify-release-artifact-directory.ts")).toBeLessThan(
      readme.indexOf("Execute README quick-start commands"),
    );

    const confirm = confirmation();
    expect(confirm).toMatch(/needs:[\s\S]*native-provenance-gate/);
    expect(confirm).toContain(
      "candidate_artifact_id: ${{ needs.candidate.outputs.candidate_artifact_id }}",
    );
    expect(publish()).toContain(
      "artifact-ids: ${{ needs.confirmation.outputs.candidate_artifact_id }}",
    );

    expect(release.indexOf("  native-provenance-gate:")).toBeLessThan(
      release.indexOf("  native-smoke:"),
    );
    expect(release.indexOf("  native-provenance-gate:")).toBeLessThan(
      release.indexOf("  readme-commands-gate:"),
    );
  });

  test("publication downloads the preserved tarball/binaries", () => {
    const pub = publish();
    expect(pub).toContain("download-artifact");
    expect(pub).toMatch(/kunai-npm\.tgz|\.tgz/);
    expect(pub).not.toContain("build:binaries");
    expect(pub).not.toContain("bun pm pack");
    expect(pub).not.toContain("bun run build");
  });

  test("GitHub release starts as draft", () => {
    const pub = publish();
    expect(pub).toMatch(/draft:\s*true/);
    expect(pub).toContain("softprops/action-gh-release");
  });

  test("draft verification precedes public promotion", () => {
    const pub = publish();
    const draftVerify = pub.search(/--expect-draft/);
    const promote = pub.search(/--draft=false|--latest|make_latest:\s*true/);
    expect(draftVerify).toBeGreaterThanOrEqual(0);
    expect(promote).toBeGreaterThan(draftVerify);
    expect(pub.indexOf("verify-github-release-assets.ts")).toBeGreaterThanOrEqual(0);
    expect(pub.match(/--attestation-repo/g)).toHaveLength(2);
    expect(pub.match(/--attestation-source-digest/g)).toHaveLength(2);
    expect(pub).toContain("--expect-public");
  });

  test("release-state verification fails closed for draft and public boundaries", () => {
    expect(() => assertExpectedReleaseState(true, "draft", "v0.3.0")).not.toThrow();
    expect(() => assertExpectedReleaseState(false, "public", "v0.3.0")).not.toThrow();
    expect(() => assertExpectedReleaseState(false, "draft", "v0.3.0")).toThrow(/expected draft/i);
    expect(() => assertExpectedReleaseState(true, "public", "v0.3.0")).toThrow(/expected public/i);
    expect(() => assertExpectedReleaseState(undefined, "public", "v0.3.0")).toThrow(
      /expected public/i,
    );
  });

  test("metadata publication follows public verification", () => {
    const meta = metadata();
    expect(meta).toMatch(/needs:\s*publish/);
    expect(meta).toContain("set-release-status.ts");
    expect(meta).toMatch(/published/);
    // Compare the metadata job's status update against public promotion in publish.
    expect(
      release.indexOf("set-release-status.ts", release.indexOf("  metadata:")),
    ).toBeGreaterThan(release.search(/--draft=false|--latest|make_latest:\s*true/));
  });

  test("protected publication declares release-production environment", () => {
    const pub = publish();
    expect(pub).toMatch(/needs:\s*confirmation/);
    expect(pub).toMatch(/environment:\s*release-production/);
  });

  test("every manual release job is restricted to main", () => {
    for (const job of [candidate(), confirmation(), publish(), metadata()]) {
      expect(job).toMatch(
        /if:\s*github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'/,
      );
    }
  });

  test("candidate creation and publication require the checked out SHA to equal origin/main", () => {
    for (const job of [candidate(), publish()]) {
      expect(job).toContain("git fetch --no-tags origin main");
      expect(job).toContain("git rev-parse HEAD");
      expect(job).toContain("git rev-parse origin/main");
    }
  });

  test("confirmation directly verifies the preserved native payload immediately before gating", () => {
    const confirm = confirmation();
    const verify = confirm.indexOf("verify-release-artifact-directory.ts");
    const attest = confirm.indexOf("verify-native-attestations.ts", verify);
    const gate = confirm.indexOf("- name: Run confirmation gate");

    expect(confirm).not.toContain("Stage binaries for confirmation");
    expect(confirm).toContain(".release-download/native");
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(attest).toBeGreaterThan(verify);
    expect(gate).toBeGreaterThan(attest);
    expect(confirm).toContain('--expected-version "${VERSION}"');
    expect(confirm).toContain("--binary-dir .release-download/native");
  });

  test("confirmation and publication verify native provenance against the exact source commit", () => {
    for (const job of [confirmation(), publish()]) {
      expect(job).toMatch(/permissions:[\s\S]*attestations:\s*read/);
      expect(job).toContain("verify-native-attestations.ts");
      expect(job).toContain('--repo "${GITHUB_REPOSITORY}"');
      expect(job).toContain('--source-digest "${GITHUB_SHA}"');
    }
  });

  test("publication verifies provenance before its first irreversible publish", () => {
    const pub = publish();
    const exactVerify = pub.indexOf("Reverify protected native publication input");
    const provenance = pub.indexOf("Verify native provenance before npm publication", exactVerify);
    const npmPublish = pub.search(PUBLISH_STEP);

    expect(exactVerify).toBeGreaterThanOrEqual(0);
    expect(provenance).toBeGreaterThan(exactVerify);
    expect(npmPublish).toBeGreaterThan(provenance);
  });

  test("protected publication reverifies native bytes immediately before draft creation", () => {
    const pub = publish();
    const createDraft = pub.indexOf("- name: Create draft GitHub release");
    const exactVerify = pub.lastIndexOf("verify-release-artifact-directory.ts", createDraft);
    const attest = pub.lastIndexOf("verify-native-attestations.ts", createDraft);

    expect(pub).toContain(".release-download/native");
    expect(exactVerify).toBeGreaterThanOrEqual(0);
    expect(attest).toBeGreaterThan(exactVerify);
    expect(createDraft).toBeGreaterThan(attest);
    for (const name of REQUIRED_RELEASE_ASSET_NAMES) {
      expect(pub).toContain(`.release-download/native/${name}`);
    }
  });

  test("confirmation and publication never rebuild or recompress preserved native assets", () => {
    for (const job of [confirmation(), publish()]) {
      expect(job).not.toContain("build:binaries");
      expect(job).not.toContain("build-release-archives");
      expect(job).not.toMatch(/^\s+(?:tar|zip|gzip)\s/m);
    }
  });

  test("candidate install gate consumes preserved local tarballs after they are created", () => {
    const cand = candidate();
    const platformBuild = cand.indexOf("bun run build:npm-platform");
    const launcherPack = cand.indexOf("bun run release:pack");
    const candidatePack = cand.indexOf("bun run release:prepare");
    const installGate = cand.indexOf("bun run test:npm-global-install");

    expect(platformBuild).toBeGreaterThanOrEqual(0);
    expect(launcherPack).toBeGreaterThanOrEqual(0);
    expect(candidatePack).toBeGreaterThanOrEqual(0);
    expect(installGate).toBeGreaterThanOrEqual(0);
    expect(platformBuild).toBeLessThan(installGate);
    expect(launcherPack).toBeLessThan(installGate);
    expect(candidatePack).toBeLessThan(installGate);
    expect(cand).toContain('KUNAI_NPM_CANDIDATE_PREBUILT: "1"');
    expect(cand).toContain(".release-candidate/npm-platform");
  });

  test("the exact launcher tarball is checked before upload and again before publication", () => {
    const cand = candidate();
    const pub = publish();
    const candidatePack = cand.indexOf("bun run release:pack");
    const candidateExactCheck = cand.indexOf("verify-npm-pack.ts --tarball");
    const candidateUpload = cand.indexOf("Upload candidate artifacts");
    const publishDownload = pub.indexOf("Download candidate artifacts");
    const publishExactCheck = pub.indexOf("verify-npm-pack.ts --tarball");
    const npmPublish = pub.search(PUBLISH_STEP);

    expect(candidatePack).toBeGreaterThanOrEqual(0);
    expect(candidateExactCheck).toBeGreaterThan(candidatePack);
    expect(candidateUpload).toBeGreaterThan(candidateExactCheck);
    expect(publishDownload).toBeGreaterThanOrEqual(0);
    expect(publishExactCheck).toBeGreaterThan(publishDownload);
    expect(npmPublish).toBeGreaterThan(publishExactCheck);
  });

  test("trusted publication pins compatible Node and npm and prints both versions", () => {
    expect(release).toContain('RELEASE_NODE_VERSION: "22.14.0"');
    expect(release).toContain('RELEASE_NPM_VERSION: "11.5.1"');
    for (const job of [candidate(), publish()]) {
      expect(job).toContain("node-version: ${{ env.RELEASE_NODE_VERSION }}");
      expect(job).toContain("npm@${RELEASE_NPM_VERSION}");
      expect(job).toContain("node --version");
      expect(job).toContain("npm --version");
    }
  });

  test("protected publish uses npm provenance and OIDC without an npm token", () => {
    const pub = publish();
    expect(pub).toMatch(/permissions:[\s\S]*contents:\s*write[\s\S]*id-token:\s*write/);
    expect(publisher).toMatch(/"publish"[\s\S]*"--access",\s*"public"[\s\S]*"--provenance"/);
    expect(release).not.toContain("NODE_AUTH_TOKEN");
    expect(release).not.toContain("bun publish");
    expect(Object.values(rootPackage.scripts).join("\n")).not.toContain("bun publish");
    expect("release:publish-tarball" in rootPackage.scripts).toBe(false);
  });

  test("pins every third-party release action to a full commit with its major comment", () => {
    const usesLines = release
      .split("\n")
      .filter((line) => /\buses:/.test(line) && !line.includes("uses: ./"));
    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) {
      const match = /uses:\s*([^@\s]+)@([0-9a-f]{40})\s+#\s+([^@\s]+)@(v\d+)\s*$/.exec(line);
      expect(match, line).not.toBeNull();
      expect(match?.[3], line).toBe(match?.[1]);
    }
  });
});

describe("release:pack script contract", () => {
  const releasePack = rootPackage.scripts["release:pack"] ?? "";
  test("buildNpmPublishManifest returns the public launcher manifest without filesystem work", () => {
    const source = {
      name: "@kitsunekode/kunai",
      version: "9.8.7",
      description: "Terminal-first media streaming CLI.",
      keywords: ["cli", "mpv"],
      homepage: "https://github.com/KitsuneKode/kunai#readme",
      bugs: { url: "https://github.com/KitsuneKode/kunai/issues" },
      license: "MIT",
      author: "kitsunekode",
      repository: { type: "git", url: "https://github.com/KitsuneKode/kunai" },
      publishConfig: { access: "public", provenance: true } as const,
    };
    const optionalDependencies = Object.fromEntries(
      RELEASE_BINARY_TARGETS.map((target) => [`@kitsunekode/kunai-${target.id}`, source.version]),
    );

    expect(buildNpmPublishManifest(source)).toEqual({
      ...source,
      type: "module",
      bin: { kunai: "dist/npm-launcher.mjs" },
      files: ["dist/npm-launcher.mjs", "LICENSE", "README.md"],
      engines: { node: ">=18.17" },
      optionalDependencies,
    });
  });

  test("buildNpmPublishManifest rejects non-MIT or non-public source policy", () => {
    const validSource = {
      name: "@kitsunekode/kunai",
      version: "9.8.7",
      license: "MIT",
      publishConfig: { access: "public", provenance: true } as const,
    };

    expect(() => buildNpmPublishManifest({ ...validSource, license: "UNLICENSED" })).toThrow(/MIT/);
    expect(() =>
      buildNpmPublishManifest({
        ...validSource,
        publishConfig: { access: "restricted", provenance: true },
      }),
    ).toThrow(/public/);
    expect(() =>
      buildNpmPublishManifest({
        ...validSource,
        publishConfig: { access: "public", provenance: false },
      }),
    ).toThrow(/provenance/);
  });

  test("does not use bun --cwd with pm or combine --destination with --filename", () => {
    expect(releasePack.length).toBeGreaterThan(0);
    // Bun treats `bun --cwd … pm` as a script named "pm", not `bun pm`.
    expect(releasePack).not.toMatch(/bun\s+--cwd\b/);
    // Bun 1.3.14 rejects combining --destination and --filename.
    const hasDestination = /\s--destination\b/.test(releasePack);
    const hasFilename = /\s--filename\b/.test(releasePack);
    expect(hasDestination && hasFilename).toBe(false);
    expect(releasePack).toContain("bun pm pack");
    expect(releasePack).toContain("kunai-npm.tgz");
    expect(releasePack).toContain(".release-candidate");
    expect(releasePack).toContain("apps/cli/dist/npm");
  });
});

describe("verifyReleaseArtifactDirectory", () => {
  test("accepts eight canonical archives, eight raw binaries, and two manifests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      writeCompleteReleaseFixture(dir);

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("restores downloaded Linux executable mode for the version smoke without changing bytes", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-mode-"));
    try {
      for (const name of requiredBinaryNames) {
        writeFileSync(
          join(dir, name),
          name === "kunai-linux-x64"
            ? '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "kunai 9.9.9"; else echo "Kunai help"; fi\n'
            : `payload:${name}\n`,
        );
      }
      chmodSync(join(dir, "kunai-linux-x64"), 0o644);
      buildReleaseArchives(dir);
      const bytesBefore = readFileSync(join(dir, "kunai-linux-x64"));

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
        }),
      ).resolves.toBeUndefined();
      expect(readFileSync(join(dir, "kunai-linux-x64"))).toEqual(bytesBefore);
      expect(statSync(join(dir, "kunai-linux-x64")).mode & 0o111).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects checksum mismatch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      writeCompleteReleaseFixture(dir);
      const archiveName = requiredArchiveNames[0]!;
      writeFileSync(join(dir, archiveName), "tampered archive");

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).rejects.toThrow(/checksum|sha256/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects missing, unexpected, and raw-byte-mutated preserved payloads", async () => {
    for (const failure of ["missing", "unexpected", "mutated"] as const) {
      const dir = mkdtempSync(join(tmpdir(), `kunai-release-assets-${failure}-`));
      try {
        writeCompleteReleaseFixture(dir);
        if (failure === "missing") {
          rmSync(join(dir, requiredArchiveNames[0]!));
        } else if (failure === "unexpected") {
          writeFileSync(join(dir, "unexpected-release-asset"), "unexpected\n");
        } else {
          writeFileSync(join(dir, requiredBinaryNames[0]!), "mutated raw bytes\n");
        }

        await expect(
          verifyReleaseArtifactDirectory({
            directory: dir,
            expectedVersion: "9.9.9",
            skipVersionSmoke: true,
          }),
        ).rejects.toThrow(failure === "unexpected" ? /unexpected/ : /missing|checksum|sha256/i);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("rejects unexpected directories instead of filtering them out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-directory-"));
    try {
      writeCompleteReleaseFixture(dir);
      mkdirSync(join(dir, "unexpected-directory"));

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).rejects.toThrow(/unexpected non-regular/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "rejects unexpected symlinks instead of following them",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-symlink-"));
      try {
        writeCompleteReleaseFixture(dir);
        symlinkSync("kunai-linux-x64", join(dir, "unexpected-symlink"));

        await expect(
          verifyReleaseArtifactDirectory({
            directory: dir,
            expectedVersion: "9.9.9",
            skipVersionSmoke: true,
          }),
        ).rejects.toThrow(/unexpected non-regular/i);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test("rejects SHA256SUMS with the wrong row count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      writeCompleteReleaseFixture(dir);
      writeFileSync(join(dir, "SHA256SUMS"), `${"a".repeat(64)}  kunai-linux-x64\n`);

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).rejects.toThrow(/8/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a legacy raw SHA256SUMS checksum mismatch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      writeCompleteReleaseFixture(dir);
      const rows = readFileSync(join(dir, "SHA256SUMS"), "utf8").split("\n");
      rows[0] = `${"a".repeat(64)}  ${requiredBinaryNames[0]}`;
      writeFileSync(join(dir, "SHA256SUMS"), rows.join("\n"));

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).rejects.toThrow(/SHA256SUMS|checksum|sha256/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a non-canonical archive even when its manifest hash matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      writeCompleteReleaseFixture(dir);
      const archiveName = requiredArchiveNames[0]!;
      const archivePath = join(dir, archiveName);
      const tampered = Buffer.concat([readFileSync(archivePath), Buffer.from("extra-entry")]);
      writeFileSync(archivePath, tampered);
      const rows = readFileSync(join(dir, "SHA256SUMS.archives"), "utf8")
        .trim()
        .split("\n")
        .map((row) =>
          row.endsWith(`  ${archiveName}`)
            ? `${createHash("sha256").update(tampered).digest("hex")}  ${archiveName}`
            : row,
        );
      writeFileSync(join(dir, "SHA256SUMS.archives"), `${rows.join("\n")}\n`);

      await expect(
        verifyReleaseArtifactDirectory({
          directory: dir,
          expectedVersion: "9.9.9",
          skipVersionSmoke: true,
        }),
      ).rejects.toThrow(/canonical|member|archive/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("release checksum authorship", () => {
  // A local build produces binaries that are byte-different from CI's, so
  // merging its SHA256SUMS replaced the committed hashes with ones no published
  // artifact can match. That file is what users verify a download against.
  test("a local build does not author release checksums", () => {
    expect(shouldWriteReleaseChecksums({})).toBe(false);
    expect(shouldWriteReleaseChecksums({ CI: "" })).toBe(false);
    expect(shouldWriteReleaseChecksums({ CI: "   " })).toBe(false);
  });

  test("CI authors them", () => {
    expect(shouldWriteReleaseChecksums({ CI: "true" })).toBe(true);
    expect(shouldWriteReleaseChecksums({ CI: "1" })).toBe(true);
  });

  test("an explicit opt-in authors them outside CI", () => {
    expect(shouldWriteReleaseChecksums({ KUNAI_WRITE_RELEASE_CHECKSUMS: "1" })).toBe(true);
  });
});
