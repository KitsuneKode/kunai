#!/usr/bin/env bun
// Build script for @kitsunekode/kunai standalone binaries.
//
// Order per target:
//   1. Bun.build with shared release options + compile target
//   2. metafile guard (+ optional analyze output)
//   3. chmod + SHA256 manifest + size summary
//
// Uses the Bun.build JS API (not the `bun build --compile` CLI) so it can apply
// the shared release stub plugin + defines — the CLI form cannot run plugins.
//
// Usage:
//   bun run scripts/build-binaries.ts
//   bun run scripts/build-binaries.ts --only linux-x64 --only linux-x64-musl
//   bun run scripts/build-binaries.ts --jobs 4 --analyze
//   bun run scripts/build-binaries.ts --output-directory /tmp/kunai-binaries

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  mergeReleaseNotesChecksums,
  shouldWriteReleaseChecksums,
} from "../../../scripts/release-binary-checksums.ts";
import { RELEASE_BINARY_TARGETS } from "../src/services/update/platform-assets";
import { buildReleaseArchives } from "./build-release-archives";
import {
  assertNoForbiddenReleaseInputs,
  compileBinaryBuildOptions,
  formatBuildSize,
  mapWithConcurrency,
  printBuildSizeTable,
  requireBuildMetafile,
  resolveBuildConcurrency,
  topReleaseInputs,
  totalMetafileInputBytes,
} from "./build-shared";

const ROOT = join(import.meta.dirname, "..");
const REPO_ROOT = join(ROOT, "../..");
const DEFAULT_OUT = join(ROOT, "dist/bin");

function resolveOutputDirectory(): string {
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] !== "--output-directory") continue;
    const value = process.argv[index + 1];
    if (!value) throw new Error("[binaries] --output-directory requires a path");
    return resolve(value);
  }
  return DEFAULT_OUT;
}

function selectedTargets() {
  const ids: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--only") {
      const targetId = process.argv[i + 1];
      if (targetId !== undefined) {
        ids.push(targetId);
        i += 1;
      }
    }
  }
  if (ids.length === 0) return RELEASE_BINARY_TARGETS;
  const match = RELEASE_BINARY_TARGETS.filter((t) => ids.includes(t.id));
  if (match.length !== ids.length) {
    const unknown = ids.filter((id) => !RELEASE_BINARY_TARGETS.some((t) => t.id === id));
    throw new Error(
      `[binaries] unknown --only target(s) "${unknown.join(", ")}". Valid: ${RELEASE_BINARY_TARGETS.map((t) => t.id).join(", ")}`,
    );
  }
  return match;
}

type CompileResult = {
  readonly target: (typeof RELEASE_BINARY_TARGETS)[number];
  readonly bytes: number;
  readonly graphBytes: number;
};

async function compileTarget(
  target: (typeof RELEASE_BINARY_TARGETS)[number],
  analyze: boolean,
  outputDirectory: string,
): Promise<CompileResult> {
  const outfile = join(outputDirectory, target.out);
  console.log(`[binaries] compiling ${target.out} (${target.triple}) ...`);

  const result = await Bun.build(
    compileBinaryBuildOptions(ROOT, { triple: target.triple, outfile }),
  );

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`[binaries] compile failed for ${target.triple}`);
  }

  const metafile = requireBuildMetafile(result.metafile);
  assertNoForbiddenReleaseInputs(metafile);

  if (analyze) {
    const metaPath = join(outputDirectory, `${target.out}.meta.json`);
    await writeFile(metaPath, `${JSON.stringify(metafile, null, 2)}\n`);
    console.log(`[binaries] wrote ${metaPath}`);
    for (const input of topReleaseInputs(metafile, 8)) {
      console.log(
        `[binaries]   graph ${formatBuildSize(input.bytes)} ${input.path.replace(/.*\/apps\/cli\//, "")}`,
      );
    }
  }

  await chmod(outfile, 0o755).catch(() => {});

  return {
    target,
    bytes: Bun.file(outfile).size,
    graphBytes: totalMetafileInputBytes(metafile),
  };
}

async function main(): Promise<void> {
  const start = Date.now();
  const targets = selectedTargets();
  const incremental = process.argv.includes("--only");
  const analyze = process.argv.includes("--analyze") || process.env.KUNAI_BUILD_ANALYZE === "1";
  const jobs = resolveBuildConcurrency(process.argv);
  const out = resolveOutputDirectory();

  if (!incremental) {
    if (out === DEFAULT_OUT) {
      await rm(out, { recursive: true, force: true });
    } else if (existsSync(out)) {
      throw new Error(
        `[binaries] custom --output-directory must not exist before an all-target build: ${out}`,
      );
    }
  }
  await mkdir(out, { recursive: true });

  const results = await mapWithConcurrency(targets, jobs, (target) =>
    compileTarget(target, analyze, out),
  );

  const retainedTargets = buildReleaseArchives(out, targets);

  const builtAllTargets = targets.length === RELEASE_BINARY_TARGETS.length;
  if (builtAllTargets && existsSync(join(out, "SHA256SUMS"))) {
    if (!shouldWriteReleaseChecksums()) {
      console.log(
        "[binaries] skipped release-notes checksum merge: local build " +
          "(set KUNAI_WRITE_RELEASE_CHECKSUMS=1 to override)",
      );
    } else {
      const version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
        version?: string;
      };
      if (version.version) {
        try {
          mergeReleaseNotesChecksums({
            repoRoot: REPO_ROOT,
            version: version.version,
            checksumsPath: join(out, "SHA256SUMS"),
          });
          console.log(`[binaries] merged SHA256SUMS into .release/kunai-v${version.version}.json`);
        } catch (error) {
          console.warn(
            `[binaries] skipped release-notes checksum merge: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  printBuildSizeTable(
    results.map((result) => ({ label: result.target.out, bytes: result.bytes })),
    `release binaries (${results.length} targets, ${jobs} job${jobs === 1 ? "" : "s"})`,
  );

  const graphKiB = Math.round(results.reduce((sum, row) => sum + row.graphBytes, 0) / 1024);
  console.log(
    `[binaries] bundled app graph ~${graphKiB} KiB total across targets; remainder of each file is the embedded Bun runtime.`,
  );

  const ms = Date.now() - start;
  console.log(
    `[binaries] wrote ${results.length} binaries; reconciled ${retainedTargets.length} archive/raw target pairs + 2 manifests in ${out} (${ms}ms)`,
  );
}

await main();
