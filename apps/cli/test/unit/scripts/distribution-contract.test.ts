import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
  const versionPr = () => extractWorkflowJob(release, "version-pr");
  const candidate = () => extractWorkflowJob(release, "candidate");
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

  test("binaries build before npm publish", () => {
    const cand = candidate();
    const pub = publish();
    expect(cand).toContain("build:binaries");
    expect(cand).not.toContain("bun publish");
    expect(pub).toMatch(/bun publish/);
    const binaryBuildIdx = release.indexOf("build:binaries");
    const npmPublishIdx = release.search(/bun publish/);
    expect(binaryBuildIdx).toBeGreaterThanOrEqual(0);
    expect(npmPublishIdx).toBeGreaterThan(binaryBuildIdx);
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
});

describe("release:pack script contract", () => {
  const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const releasePack = rootPackage.scripts["release:pack"] ?? "";

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
  });

  test("bun run release:pack writes a non-empty .release-candidate/kunai-npm.tgz", async () => {
    const tarball = join(REPO_ROOT, ".release-candidate", "kunai-npm.tgz");
    try {
      if (existsSync(tarball)) {
        unlinkSync(tarball);
      }
      const proc = Bun.spawn(["bun", "run", "release:pack"], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(exitCode, `release:pack failed\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
      expect(existsSync(tarball)).toBe(true);
      expect(statSync(tarball).size).toBeGreaterThan(0);
    } finally {
      if (existsSync(tarball)) {
        unlinkSync(tarball);
      }
    }
  }, 30_000);
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
