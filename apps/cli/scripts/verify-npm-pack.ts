#!/usr/bin/env bun
// Verify the published npm tarball stays small and never includes compiled binaries.

import { spawnSync } from "node:child_process";
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
  const result = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      // Keep verification hermetic: npm otherwise writes to the user's cache,
      // which is unavailable in sandboxes and unnecessary for a dry pack.
      npm_config_cache: join(tmpdir(), "kunai-npm-pack-cache"),
    },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    console.error(output);
    process.exit(result.status ?? 1);
  }

  const summary = verifyNpmPackDryRun(output);
  console.log(
    `[pkg:check] ok — ${summary.paths.length} files, packed ${formatBuildSize(summary.packedBytes)} / ${formatBuildSize(NPM_PACK_PACKED_BUDGET_BYTES)}, unpacked ${formatBuildSize(summary.unpackedBytes)} / ${formatBuildSize(NPM_PACK_UNPACKED_BUDGET_BYTES)}`,
  );
}

if (import.meta.path === Bun.main) {
  main();
}
