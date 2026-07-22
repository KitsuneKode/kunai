#!/usr/bin/env bun
// Generate the deliberately small manifest published as @kitsunekode/kunai.
//
// apps/cli/package.json is a workspace development manifest. Publishing it
// would leak workspace dependencies and claim that the Node launcher requires
// Bun, so the release candidate gets a separate manifest under dist/npm.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "../src/services/update/platform-assets";

const ROOT = join(import.meta.dirname, "..");
const OUTPUT_DIRECTORY = join(ROOT, "dist/npm");
const OUTPUT_PATH = join(OUTPUT_DIRECTORY, "package.json");

export type NpmPublishManifestSource = {
  readonly name: string;
  readonly version: string;
};

/**
 * Build the public launcher manifest from the workspace package identity.
 * Keep this pure so the package contract is independent of filesystem state.
 */
export function buildNpmPublishManifest(source: NpmPublishManifestSource) {
  return {
    name: source.name,
    version: source.version,
    type: "module",
    bin: { kunai: "dist/npm-launcher.mjs" },
    files: ["dist/npm-launcher.mjs"],
    engines: { node: ">=18.17" },
    optionalDependencies: Object.fromEntries(
      RELEASE_BINARY_TARGETS.map((target) => [`@kitsunekode/kunai-${target.id}`, source.version]),
    ),
  };
}

export async function writeNpmPublishManifest(): Promise<void> {
  const source = (await Bun.file(join(ROOT, "package.json")).json()) as NpmPublishManifestSource;
  const manifest = buildNpmPublishManifest(source);

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await Bun.write(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[npm-publish-manifest] wrote ${OUTPUT_PATH}`);
}

if (import.meta.path === Bun.main) {
  await writeNpmPublishManifest();
}
