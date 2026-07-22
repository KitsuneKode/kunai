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
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly homepage?: string;
  readonly bugs?: { readonly url?: string };
  readonly license?: string;
  readonly author?: unknown;
  readonly repository?: unknown;
  readonly publishConfig?: {
    readonly access?: string;
    readonly provenance?: boolean;
  };
};

/**
 * Build the public launcher manifest from the workspace package identity.
 * Keep this pure so the package contract is independent of filesystem state.
 */
export function buildNpmPublishManifest(source: NpmPublishManifestSource) {
  if (source.license !== "MIT") {
    throw new Error("[npm-publish-manifest] source package license must be MIT.");
  }
  if (source.publishConfig?.access !== "public") {
    throw new Error("[npm-publish-manifest] source package publishConfig access must be public.");
  }
  if (source.publishConfig.provenance !== true) {
    throw new Error("[npm-publish-manifest] source package must publish with provenance.");
  }

  return {
    name: source.name,
    version: source.version,
    ...(source.description ? { description: source.description } : {}),
    ...(source.keywords ? { keywords: source.keywords } : {}),
    ...(source.homepage ? { homepage: source.homepage } : {}),
    ...(source.bugs ? { bugs: source.bugs } : {}),
    license: source.license,
    ...(source.author ? { author: source.author } : {}),
    ...(source.repository ? { repository: source.repository } : {}),
    type: "module",
    bin: { kunai: "dist/npm-launcher.mjs" },
    files: ["dist/npm-launcher.mjs", "LICENSE"],
    engines: { node: ">=18.17" },
    optionalDependencies: Object.fromEntries(
      RELEASE_BINARY_TARGETS.map((target) => [`@kitsunekode/kunai-${target.id}`, source.version]),
    ),
    publishConfig: {
      access: source.publishConfig.access,
      provenance: source.publishConfig.provenance,
    },
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
