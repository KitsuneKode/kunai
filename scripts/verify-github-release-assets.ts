#!/usr/bin/env bun
// =============================================================================
// verify-github-release-assets.ts — assert a GitHub Release has every required asset.
//
// Usage:
//   bun run scripts/verify-github-release-assets.ts              # latest (names + sizes)
//   bun run scripts/verify-github-release-assets.ts v0.3.0
//   bun run scripts/verify-github-release-assets.ts v0.3.0 \
//     --expect-draft --expected-version 0.3.0
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
import { verifyReleaseArtifactDirectory } from "./verify-release-artifact-directory";

type GhReleaseView = {
  readonly isDraft?: boolean;
  readonly tagName?: string;
  readonly assets?: readonly { readonly name?: string; readonly size?: number }[];
};

function parseArgs(argv: readonly string[]): {
  tag: string | undefined;
  expectDraft: boolean;
  expectedVersion: string | undefined;
} {
  let tag: string | undefined;
  let expectDraft = false;
  let expectedVersion: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--expect-draft") {
      expectDraft = true;
      continue;
    }
    if (arg === "--expected-version") {
      expectedVersion = argv[++i];
      if (!expectedVersion) {
        throw new Error("[release-assets] --expected-version requires a semver value");
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

  return { tag, expectDraft, expectedVersion };
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
  return JSON.parse(result.stdout) as GhReleaseView;
}

function descriptorsFromRelease(release: GhReleaseView): ReleaseAssetDescriptor[] {
  const assets = release.assets ?? [];
  return assets.map((asset) => ({
    name: String(asset.name ?? ""),
    size: typeof asset.size === "number" ? asset.size : 0,
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

async function main(): Promise<void> {
  const { tag, expectDraft, expectedVersion } = parseArgs(process.argv.slice(2));
  const release = viewRelease(tag);

  if (expectDraft && release.isDraft !== true) {
    throw new Error(
      `[release-assets] expected draft release` +
        (tag ? ` for ${tag}` : "") +
        `, got isDraft=${String(release.isDraft)}`,
    );
  }

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
      await verifyReleaseArtifactDirectory({
        directory: tempDir,
        expectedVersion,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log(
    `[release-assets] OK — ${REQUIRED_RELEASE_ASSET_NAMES.length} required assets present` +
      (tag ? ` on ${tag}` : " on latest") +
      (expectDraft ? " (draft)" : "") +
      (expectedVersion ? ` / verified v${expectedVersion}` : "") +
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
