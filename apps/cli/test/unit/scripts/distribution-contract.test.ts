import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertCompleteReleaseAssetSet,
  assertRequiredReleaseAssets,
} from "../../../../../scripts/release-asset-contract";
import { shouldWriteReleaseChecksums } from "../../../../../scripts/release-binary-checksums";
import { verifyReleaseArtifactDirectory } from "../../../../../scripts/verify-release-artifact-directory";
import { buildNpmPublishManifest } from "../../../scripts/write-npm-publish-manifest";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");
const requiredAssetNames = REQUIRED_RELEASE_ASSET_NAMES;
const requiredBinaryNames = RELEASE_BINARY_TARGETS.map((t) => t.out).sort();

function completeSizedAssets(size = 1) {
  return requiredAssetNames.map((name) => ({ name, size }));
}

describe("distribution release-asset contract", () => {
  test("required assets are RELEASE_BINARY_TARGETS outs plus SHA256SUMS", () => {
    expect([...REQUIRED_RELEASE_ASSET_NAMES]).toEqual(
      [...RELEASE_BINARY_TARGETS.map((t) => t.out), "SHA256SUMS"].sort(),
    );
    expect(REQUIRED_RELEASE_ASSET_NAMES).toHaveLength(RELEASE_BINARY_TARGETS.length + 1);
  });

  test("assertRequiredReleaseAssets accepts a complete set and rejects gaps", () => {
    expect(() => assertRequiredReleaseAssets(REQUIRED_RELEASE_ASSET_NAMES)).not.toThrow();
    expect(() => assertRequiredReleaseAssets(["SHA256SUMS"])).toThrow(/missing/);
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
  const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const versionPr = () => extractWorkflowJob(release, "version-pr");
  const candidate = () => extractWorkflowJob(release, "candidate");
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
    expect(rootPackage.scripts["release:publish-tarball"]).toBeUndefined();
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
  const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
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
      files: ["dist/npm-launcher.mjs", "LICENSE"],
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
  test("accepts a fixture with eight checksum rows and matching hashes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      const sums: string[] = [];
      for (const name of requiredBinaryNames) {
        const body = `payload:${name}\n`;
        writeFileSync(join(dir, name), body);
        sums.push(`${createHash("sha256").update(body).digest("hex")}  ${name}`);
      }
      writeFileSync(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);

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

  test("rejects checksum mismatch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      const sums: string[] = [];
      for (const name of requiredBinaryNames) {
        writeFileSync(join(dir, name), `payload:${name}\n`);
        sums.push(`${"a".repeat(64)}  ${name}`);
      }
      writeFileSync(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);

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

  test("rejects SHA256SUMS with the wrong row count", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-release-assets-"));
    try {
      for (const name of requiredBinaryNames) {
        writeFileSync(join(dir, name), `payload:${name}\n`);
      }
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
