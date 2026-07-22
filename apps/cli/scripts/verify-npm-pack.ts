#!/usr/bin/env bun
// Verify the published npm tarball stays small and never includes compiled binaries.

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertNpmPackBudgets,
  assertNpmPackContents,
  formatBuildSize,
  NPM_PACK_PACKED_BUDGET_BYTES,
  NPM_PACK_UNPACKED_BUDGET_BYTES,
} from "./build-shared";

const ROOT = join(import.meta.dirname, "..");
const NPM_PUBLISH_ROOT = join(ROOT, "dist/npm");

type NpmPublishManifest = {
  readonly bin?: Record<string, string>;
  readonly dependencies?: unknown;
  readonly engines?: Record<string, string>;
  readonly files?: string[];
  readonly module?: unknown;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: unknown;
};

/** Reject workspace-only metadata before checking the generated tarball. */
export function assertNpmPublishManifest(manifest: NpmPublishManifest): void {
  if (manifest.dependencies !== undefined || manifest.peerDependencies !== undefined) {
    throw new Error(
      "[pkg:check] npm publish manifest must not contain runtime or peer dependencies.",
    );
  }
  if (manifest.module !== undefined) {
    throw new Error("[pkg:check] npm publish manifest must not contain a module entrypoint.");
  }
  if (manifest.engines?.bun !== undefined) {
    throw new Error("[pkg:check] npm publish manifest must not require Bun.");
  }
  if (manifest.bin?.kunai !== "dist/npm-launcher.mjs") {
    throw new Error("[pkg:check] npm publish manifest must use dist/npm-launcher.mjs as its bin.");
  }
  if (manifest.files?.length !== 1 || manifest.files[0] !== "dist/npm-launcher.mjs") {
    throw new Error("[pkg:check] npm publish manifest must include only dist/npm-launcher.mjs.");
  }
}

export type NpmPackDryRun = {
  readonly paths: string[];
  readonly packedBytes: number;
  readonly unpackedBytes: number;
};

/** Parse `npm pack --dry-run --ignore-scripts` stdout (npm notice format). */
export function parseNpmPackDryRun(stdout: string): NpmPackDryRun {
  const paths: string[] = [];
  let packedBytes = 0;
  let unpackedBytes = 0;
  let inContents = false;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.endsWith("Tarball Contents")) {
      inContents = true;
      continue;
    }
    if (trimmed.endsWith("Tarball Details")) {
      inContents = false;
      continue;
    }
    if (inContents) {
      const match = /^npm notice\s+(\S+)\s+(.+)$/.exec(line);
      if (match?.[2]) {
        paths.push(match[2].trim());
      }
      continue;
    }
    const packed = /^npm notice package size:\s+(.+)$/i.exec(trimmed);
    if (packed?.[1]) {
      packedBytes = parseNpmSize(packed[1]);
      continue;
    }
    const unpacked = /^npm notice unpacked size:\s+(.+)$/i.exec(trimmed);
    if (unpacked?.[1]) {
      unpackedBytes = parseNpmSize(unpacked[1]);
    }
  }

  return { paths, packedBytes, unpackedBytes };
}

function parseNpmSize(raw: string): number {
  const match = /^([\d.]+)\s*([kmgt]?i?b)$/i.exec(raw.trim());
  if (!match?.[1] || !match[2]) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1_000,
    kib: 1024,
    mb: 1_000_000,
    mib: 1024 * 1024,
    gb: 1_000_000_000,
    gib: 1024 * 1024 * 1024,
  };
  return Math.round(value * (multipliers[unit] ?? 1));
}

export function verifyNpmPackDryRun(stdout: string): NpmPackDryRun {
  const summary = parseNpmPackDryRun(stdout);
  assertNpmPackContents(summary.paths);
  assertNpmPackBudgets(summary.packedBytes, summary.unpackedBytes);
  return summary;
}

function main(): void {
  const result = Bun.spawnSync(["npm", "pack", "--dry-run", "--ignore-scripts"], {
    cwd: NPM_PUBLISH_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Keep verification hermetic: npm otherwise writes to the user's cache,
      // which is unavailable in sandboxes and unnecessary for a dry pack.
      npm_config_cache: join(tmpdir(), "kunai-npm-pack-cache"),
    },
  });
  const decoder = new TextDecoder();
  const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;
  if (result.exitCode !== 0) {
    console.error(output);
    process.exit(result.exitCode ?? 1);
  }

  const manifest = JSON.parse(
    readFileSync(join(NPM_PUBLISH_ROOT, "package.json"), "utf8"),
  ) as NpmPublishManifest;
  assertNpmPublishManifest(manifest);
  const summary = verifyNpmPackDryRun(output);
  console.log(
    `[pkg:check] ok — ${summary.paths.length} files, packed ${formatBuildSize(summary.packedBytes)} / ${formatBuildSize(NPM_PACK_PACKED_BUDGET_BYTES)}, unpacked ${formatBuildSize(summary.unpackedBytes)} / ${formatBuildSize(NPM_PACK_UNPACKED_BUDGET_BYTES)}`,
  );
}

if (import.meta.path === Bun.main) {
  main();
}
