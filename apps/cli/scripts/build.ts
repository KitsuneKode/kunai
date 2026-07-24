#!/usr/bin/env bun
// Build script for @kitsunekode/kunai.
//
// Order:
//   1. validate entry
//   2. clean npm dist artifacts (preserve dist/bin/)
//   3. Bun.build the unpublished development app bundle (workspace packages inlined)
//   4. metafile guard (no tests/experiments/legacy in graph)
//   5. optional bundle budget check
//   6. generate the public Node launcher package (launcher + manifest + license)
//   7. chmod + size summary
//
// Runtime assets (VidKing WASM, mpv Lua bridge) are referenced from source via
// `import … with { type: "file" }`, so Bun emits them into dist/assets and
// rewrites import paths. `bun build --compile` embeds them into binaries too.

import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertNpmBundleBudget,
  CLI_ENTRY,
  formatBuildSize,
  NPM_BUNDLE_OUT,
  NPM_LAUNCHER_ENTRY,
  NPM_LAUNCHER_OUT,
  assertNoForbiddenReleaseInputs,
  forbiddenReleaseInputs,
  npmBundleBuildOptions,
  printBuildSizeTable,
  requireBuildMetafile,
  topReleaseInputs,
} from "./build-shared";
import { writeNpmPublishManifest } from "./write-npm-publish-manifest";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const ENTRY = join(ROOT, CLI_ENTRY);
const BIN = join(ROOT, NPM_BUNDLE_OUT);
const LAUNCHER = join(ROOT, NPM_LAUNCHER_OUT);
const NPM_PUBLISH_LAUNCHER = join(DIST, "npm/dist/npm-launcher.mjs");
const REPOSITORY_LICENSE = join(ROOT, "../..", "LICENSE");
const NPM_PUBLISH_LICENSE = join(DIST, "npm/LICENSE");
// The CLI readme, not the repository one: npm renders this as the package page,
// and the root readme is both monorepo-shaped and far past the pack budget.
const CLI_README = join(ROOT, "README.md");
const NPM_PUBLISH_README = join(DIST, "npm/README.md");
const NPM_PUBLISH_MANIFEST = join(DIST, "npm/package.json");
const ASSETS = join(DIST, "assets");

const clean = process.argv.includes("--clean");
const noMinify = process.argv.includes("--no-minify");
const analyze = process.argv.includes("--analyze") || process.env.KUNAI_BUILD_ANALYZE === "1";
const skipBudget = process.argv.includes("--no-budget");

async function assetBytes(): Promise<number> {
  if (!existsSync(ASSETS)) return 0;
  const names = await readdir(ASSETS);
  let total = 0;
  for (const name of names) {
    total += (await stat(join(ASSETS, name))).size;
  }
  return total;
}

async function cleanNpmDistArtifacts(): Promise<void> {
  await rm(BIN, { force: true });
  await rm(LAUNCHER, { force: true });
  await rm(join(DIST, "build-meta.json"), { force: true });
  await rm(ASSETS, { recursive: true, force: true });
  await rm(join(DIST, "npm"), { recursive: true, force: true });
}

/**
 * Build the plain-Node launcher copies.
 *
 * `dist/kunai.mjs` remains a build output for compatibility, while
 * `dist/npm/dist/npm-launcher.mjs` is the public npm entry point. Both are
 * copied verbatim, never bundled: bundling previously pulled `bun:` imports
 * into the published entry point and made `npm install -g` unusable without Bun.
 */
async function buildNpmLauncher(): Promise<number> {
  const source = join(ROOT, NPM_LAUNCHER_ENTRY);
  if (!existsSync(source)) {
    console.error(`[build] Missing launcher source ${NPM_LAUNCHER_ENTRY}`);
    process.exit(1);
  }

  await cp(source, LAUNCHER);
  await chmod(LAUNCHER, 0o755);
  await mkdir(join(DIST, "npm/dist"), { recursive: true });
  await cp(source, NPM_PUBLISH_LAUNCHER);
  await chmod(NPM_PUBLISH_LAUNCHER, 0o755);
  await cp(REPOSITORY_LICENSE, NPM_PUBLISH_LICENSE);
  await cp(CLI_README, NPM_PUBLISH_README);

  const text = await Bun.file(LAUNCHER).text();
  if (!text.startsWith("#!/usr/bin/env node")) {
    console.error("[build] Launcher must start with a Node shebang.");
    process.exit(1);
  }
  if (/from\s+["']bun:|require\(["']bun:/.test(text)) {
    console.error("[build] Launcher must not import bun: modules — it runs under plain Node.");
    process.exit(1);
  }

  return Bun.file(LAUNCHER).size;
}

async function main(): Promise<void> {
  const start = Date.now();

  if (!clean && !existsSync(ENTRY)) {
    throw new Error(`[build] missing CLI entry: ${ENTRY}`);
  }

  if (clean) {
    await rm(DIST, { recursive: true, force: true });
    console.log("[build] cleaned dist/");
    return;
  }

  await cleanNpmDistArtifacts();

  const result = await Bun.build(npmBundleBuildOptions(ROOT, { minify: !noMinify }));

  if (!result.success) {
    console.error("[build] Bun build failed");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const metafile = requireBuildMetafile(result.metafile);
  assertNoForbiddenReleaseInputs(metafile);

  if (!existsSync(BIN)) {
    console.error("[build] Build succeeded but dist/kunai.js was not created.");
    console.error("[build] Bun outputs:");
    for (const output of result.outputs) {
      console.error(`- ${output.path}`);
    }
    process.exit(1);
  }

  await chmod(BIN, 0o755);

  const launcherBytes = await buildNpmLauncher();
  await writeNpmPublishManifest();

  const bundleBytes = Bun.file(BIN).size;
  const licenseBytes = Bun.file(NPM_PUBLISH_LICENSE).size;
  const manifestBytes = Bun.file(NPM_PUBLISH_MANIFEST).size;
  const readmeBytes = Bun.file(NPM_PUBLISH_README).size;
  const assetsTotal = await assetBytes();
  const ms = Date.now() - start;

  printBuildSizeTable(
    [
      { label: "dist/kunai.mjs (local launcher compatibility)", bytes: launcherBytes },
      { label: "dist/npm/dist/npm-launcher.mjs (public launcher)", bytes: launcherBytes },
      { label: "dist/npm/LICENSE (public license)", bytes: licenseBytes },
      { label: "dist/npm/README.md (public package page)", bytes: readmeBytes },
      { label: "dist/npm/package.json (public manifest)", bytes: manifestBytes },
      { label: "dist/kunai.js (development Bun bundle, unpublished)", bytes: bundleBytes },
      { label: "dist/assets/* (development bundle assets, unpublished)", bytes: assetsTotal },
      {
        label: "dist/npm public files total",
        bytes: launcherBytes + licenseBytes + manifestBytes,
      },
    ],
    "CLI build outputs",
  );
  console.log(`[build] completed in ${ms}ms`);

  for (const input of topReleaseInputs(metafile, 5)) {
    console.log(`[build] input ${formatBuildSize(input.bytes)} ${input.path}`);
  }

  if (!skipBudget && !noMinify) {
    assertNpmBundleBudget(bundleBytes);
  }

  if (analyze) {
    const metaPath = join(DIST, "build-meta.json");
    await writeFile(metaPath, `${JSON.stringify(metafile, null, 2)}\n`);
    console.log(`[build] wrote ${metaPath}`);
    console.log(`[build] release graph inputs: ${Object.keys(metafile.inputs).length}`);
    console.log(`[build] forbidden non-prod inputs: ${forbiddenReleaseInputs(metafile).length}`);
    for (const input of topReleaseInputs(metafile)) {
      console.log(`[build] input ${formatBuildSize(input.bytes)} ${input.path}`);
    }
  }
}

await main();
