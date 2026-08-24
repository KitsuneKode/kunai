#!/usr/bin/env bun
// =============================================================================
// verify-github-release-assets.ts — assert a GitHub Release has every required asset.
//
// Usage:
//   bun run scripts/verify-github-release-assets.ts              # latest (names + sizes)
//   bun run scripts/verify-github-release-assets.ts v0.3.0
//   bun run scripts/verify-github-release-assets.ts v0.3.0 \
//     --expect-draft --expected-version 0.3.0 \
//     --attestation-repo KitsuneKode/kunai \
//     --attestation-source-digest <40-character-commit-sha>
// =============================================================================

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertCompleteReleaseAssetSet,
  type ReleaseAssetDescriptor,
} from "./release-asset-contract";
import { verifyNativeAttestations } from "./verify-native-attestations";
import {
  smokeReleaseLinuxX64,
  verifyReleaseArtifactDirectory,
} from "./verify-release-artifact-directory";

type GhReleaseView = {
  readonly isDraft?: boolean;
  readonly tagName?: string;
  readonly assets?: readonly { readonly name?: string; readonly size?: number }[];
};

type GitHubReleaseAssetArguments = {
  readonly tag: string | undefined;
  readonly expectDraft: boolean;
  readonly expectPublic: boolean;
  readonly expectedVersion: string | undefined;
  readonly attestationRepository: string | undefined;
  readonly attestationSourceDigest: string | undefined;
};

function parseArgs(argv: readonly string[]): GitHubReleaseAssetArguments {
  let tag: string | undefined;
  let expectDraft = false;
  let expectPublic = false;
  let expectedVersion: string | undefined;
  let attestationRepository: string | undefined;
  let attestationSourceDigest: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--expect-draft") {
      expectDraft = true;
      continue;
    }
    if (arg === "--expect-public") {
      expectPublic = true;
      continue;
    }
    if (arg === "--expected-version") {
      expectedVersion = argv[++i];
      if (!expectedVersion) {
        throw new Error("[release-assets] --expected-version requires a semver value");
      }
      continue;
    }
    if (arg === "--attestation-repo") {
      attestationRepository = argv[++i];
      if (!attestationRepository) {
        throw new Error("[release-assets] --attestation-repo requires owner/name");
      }
      continue;
    }
    if (arg === "--attestation-source-digest") {
      attestationSourceDigest = argv[++i];
      if (!attestationSourceDigest) {
        throw new Error("[release-assets] --attestation-source-digest requires a Git commit SHA");
      }
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`[release-assets] unknown option: ${arg}`);
    }
    if (tag) {
      throw new Error(`[release-assets] unexpected argument: ${arg}`);
    }
    tag = arg;
  }

  if (Boolean(attestationRepository) !== Boolean(attestationSourceDigest)) {
    throw new Error(
      "[release-assets] --attestation-repo and --attestation-source-digest are required together",
    );
  }
  if (attestationRepository && !expectedVersion) {
    throw new Error("[release-assets] attestation verification requires --expected-version");
  }
  if (expectedVersion && (!attestationRepository || !attestationSourceDigest)) {
    throw new Error(
      "[release-assets] --expected-version requires --attestation-repo and --attestation-source-digest before version smoke",
    );
  }
  if (expectDraft && expectPublic) {
    throw new Error("[release-assets] --expect-draft and --expect-public are mutually exclusive");
  }

  return {
    tag,
    expectDraft,
    expectPublic,
    expectedVersion,
    attestationRepository,
    attestationSourceDigest,
  };
}

export function assertExpectedReleaseState(
  isDraft: boolean | undefined,
  expected: "draft" | "public" | undefined,
  tag?: string,
): void {
  if (expected === "draft" && isDraft !== true) {
    throw new Error(
      `[release-assets] expected draft release${tag ? ` for ${tag}` : ""}, got isDraft=${String(isDraft)}`,
    );
  }
  if (expected === "public" && isDraft !== false) {
    throw new Error(
      `[release-assets] expected public release${tag ? ` for ${tag}` : ""}, got isDraft=${String(isDraft)}`,
    );
  }
}

function viewRelease(tag: string | undefined): GhReleaseView {
  const args = ["release", "view"];
  if (tag) args.push(tag);
  args.push("--json", "isDraft,tagName,assets");

  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "gh release view failed").trim();
    throw new Error(`[release-assets] ${detail}`);
  }
  // SAFETY: `gh release view --json isDraft,tagName,assets` owns this local
  // machine-readable shape; all asset names/counts/sizes are checked by the
  // exact release contract before downloaded bytes are trusted.
  return JSON.parse(result.stdout) as GhReleaseView;
}

function descriptorsFromRelease(release: GhReleaseView): ReleaseAssetDescriptor[] {
  const assets = release.assets ?? [];
  return assets.map((asset) => ({
    name: String(asset.name ?? ""),
    size: Number.isFinite(asset.size) ? (asset.size ?? 0) : 0,
  }));
}

function downloadReleaseAssets(tag: string, directory: string): void {
  const result = spawnSync("gh", ["release", "download", tag, "--dir", directory, "--clobber"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "gh release download failed").trim();
    throw new Error(`[release-assets] ${detail}`);
  }
}

type DownloadedReleaseVerification = {
  readonly directory: string;
  readonly expectedVersion: string;
  readonly attestationRepository: string | undefined;
  readonly attestationSourceDigest: string | undefined;
};

type DownloadedReleaseVerificationDependencies = {
  readonly verifyDirectory: typeof verifyReleaseArtifactDirectory;
  readonly verifyAttestations: typeof verifyNativeAttestations;
  readonly smokeLinuxX64: typeof smokeReleaseLinuxX64;
};

const downloadedReleaseVerificationDependencies: DownloadedReleaseVerificationDependencies = {
  verifyDirectory: verifyReleaseArtifactDirectory,
  verifyAttestations: verifyNativeAttestations,
  smokeLinuxX64: smokeReleaseLinuxX64,
};

/**
 * Verify untrusted release downloads without ever executing them before their
 * workflow and source-commit identity is authenticated.
 */
export async function verifyDownloadedReleaseAssets(
  input: DownloadedReleaseVerification,
  dependencies: DownloadedReleaseVerificationDependencies = downloadedReleaseVerificationDependencies,
): Promise<void> {
  if (!input.attestationRepository || !input.attestationSourceDigest) {
    throw new Error(
      "[release-assets] --expected-version requires complete attestation arguments before version smoke",
    );
  }

  await dependencies.verifyDirectory({
    directory: input.directory,
    expectedVersion: input.expectedVersion,
    skipVersionSmoke: true,
  });
  dependencies.verifyAttestations({
    directory: input.directory,
    repository: input.attestationRepository,
    sourceDigest: input.attestationSourceDigest,
  });
  dependencies.smokeLinuxX64(input.directory, input.expectedVersion);
}

async function main(): Promise<void> {
  const {
    tag,
    expectDraft,
    expectPublic,
    expectedVersion,
    attestationRepository,
    attestationSourceDigest,
  } = parseArgs(process.argv.slice(2));
  const release = viewRelease(tag);

  assertExpectedReleaseState(
    release.isDraft,
    expectDraft ? "draft" : expectPublic ? "public" : undefined,
    tag,
  );

  const descriptors = descriptorsFromRelease(release);
  assertCompleteReleaseAssetSet(descriptors);

  if (expectedVersion) {
    const downloadTag = tag ?? release.tagName;
    if (!downloadTag) {
      throw new Error(
        "[release-assets] --expected-version requires an explicit tag or a release with tagName",
      );
    }
    const tempDir = mkdtempSync(join(tmpdir(), "kunai-gh-release-assets-"));
    try {
      downloadReleaseAssets(downloadTag, tempDir);
      await verifyDownloadedReleaseAssets({
        directory: tempDir,
        expectedVersion,
        attestationRepository,
        attestationSourceDigest,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log(
    `[release-assets] OK — ${REQUIRED_RELEASE_ASSET_NAMES.length} required assets present` +
      (tag ? ` on ${tag}` : " on latest") +
      (expectDraft ? " (draft)" : "") +
      (expectPublic ? " (public)" : "") +
      (expectedVersion ? ` / verified v${expectedVersion}` : "") +
      (attestationRepository ? " / provenance verified" : "") +
      ".",
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
