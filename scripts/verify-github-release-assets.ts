#!/usr/bin/env bun
// =============================================================================
// verify-github-release-assets.ts — assert a GitHub Release has every required asset.
//
// Usage:
//   bun run scripts/verify-github-release-assets.ts              # latest
//   bun run scripts/verify-github-release-assets.ts v0.3.0
// =============================================================================

import { spawnSync } from "node:child_process";

import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertRequiredReleaseAssets,
} from "./release-asset-contract";

function listReleaseAssetNames(tag: string | undefined): string[] {
  const args = ["release", "view"];
  if (tag) args.push(tag);
  args.push("--json", "assets", "--jq", ".assets[].name");

  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "gh release view failed").trim();
    throw new Error(`[release-assets] ${detail}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function main(): void {
  const tag = process.argv[2];
  const names = listReleaseAssetNames(tag);
  assertRequiredReleaseAssets(names);
  console.log(
    `[release-assets] OK — ${REQUIRED_RELEASE_ASSET_NAMES.length} required assets present` +
      (tag ? ` on ${tag}` : " on latest") +
      ".",
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
