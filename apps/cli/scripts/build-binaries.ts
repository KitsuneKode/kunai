#!/usr/bin/env bun
// Build script for @kitsunekode/kunai standalone binaries.
//
// Cross-compiles a single-file, runtime-embedded executable per target (Bun
// cross-compiles every target from one host) and writes a SHA256SUMS manifest.
// Runtime assets (VidKing WASM, mpv Lua bridge) are embedded automatically via
// the `import … with { type: "file" }` references in source.
//
// Uses the Bun.build JS API (not the `bun build --compile` CLI) so it can apply
// the shared release stub plugin + defines — the CLI form cannot run plugins, so
// it fails to resolve `react-devtools-core`. `--bytecode` is intentionally NOT
// used: it cannot compile Ink/yoga's top-level `await` (parse errors).
//
// Usage:
//   bun run scripts/build-binaries.ts                   # all targets
//   bun run scripts/build-binaries.ts --only linux-x64  # one target (faster smoke)
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  RELEASE_DEFINE,
  assertNoForbiddenReleaseInputs,
  reactDevtoolsStubPlugin,
  requireBuildMetafile,
} from "./build-shared";

const ROOT = join(import.meta.dirname, "..");
const ENTRY = join(ROOT, "src/main.ts");
const OUT = join(ROOT, "dist/bin");

type Target = { readonly id: string; readonly triple: string; readonly out: string };

const TARGETS: readonly Target[] = [
  { id: "linux-x64", triple: "bun-linux-x64", out: "kunai-linux-x64" },
  { id: "linux-arm64", triple: "bun-linux-arm64", out: "kunai-linux-arm64" },
  { id: "darwin-x64", triple: "bun-darwin-x64", out: "kunai-darwin-x64" },
  { id: "darwin-arm64", triple: "bun-darwin-arm64", out: "kunai-darwin-arm64" },
  { id: "windows-x64", triple: "bun-windows-x64", out: "kunai-windows-x64.exe" },
];

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function selectedTargets(): readonly Target[] {
  const onlyIdx = process.argv.indexOf("--only");
  if (onlyIdx === -1) return TARGETS;
  const id = process.argv[onlyIdx + 1];
  const match = TARGETS.filter((t) => t.id === id);
  if (match.length === 0) {
    throw new Error(
      `[binaries] unknown --only target "${id}". Valid: ${TARGETS.map((t) => t.id).join(", ")}`,
    );
  }
  return match;
}

async function compileTarget(target: Target): Promise<void> {
  const outfile = join(OUT, target.out);
  console.log(`[binaries] compiling ${target.out} (${target.triple}) ...`);

  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    minify: true,
    define: RELEASE_DEFINE,
    drop: ["debugger"],
    metafile: true,
    plugins: [reactDevtoolsStubPlugin(ROOT)],
    // `compile` produces a single self-contained executable for the given target.
    compile: { target: target.triple, outfile },
  } as Parameters<typeof Bun.build>[0]);

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`[binaries] compile failed for ${target.triple}`);
  }
  assertNoForbiddenReleaseInputs(requireBuildMetafile(result.metafile));
}

async function main(): Promise<void> {
  const start = Date.now();
  const targets = selectedTargets();

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const sums: string[] = [];
  for (const target of targets) {
    await compileTarget(target);
    const outfile = join(OUT, target.out);
    // Compiled binaries are not always marked executable on extraction.
    await chmod(outfile, 0o755).catch(() => {});
    sums.push(`${await sha256(outfile)}  ${target.out}`);
  }

  await writeFile(join(OUT, "SHA256SUMS"), `${sums.join("\n")}\n`);

  const ms = Date.now() - start;
  console.log(`[binaries] wrote ${targets.length} binaries + SHA256SUMS to ${OUT} (${ms}ms)`);
}

await main();
