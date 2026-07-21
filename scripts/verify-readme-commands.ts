#!/usr/bin/env bun
// =============================================================================
// verify-readme-commands.ts — run the exact README Quick Start commands.
//
// Usage:
//   bun run scripts/verify-readme-commands.ts -- \
//     --mode fixture-assets --version 0.3.0 \
//     --binary apps/cli/dist/bin/kunai-linux-x64
// =============================================================================

import { resolve } from "node:path";

import {
  allReadmeCommandsPassed,
  verifyReadmeCommands,
  type ReadmeCommandMode,
} from "../apps/cli/test/integration/helpers/readme-command-harness";

function usage(): never {
  console.error(`Usage:
  bun run scripts/verify-readme-commands.ts -- \\
    --mode fixture-assets|published-assets \\
    --version <semver> \\
    --binary <path-to-kunai-linux-x64>
`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): {
  mode: ReadmeCommandMode;
  version: string;
  binary: string;
} {
  let mode: ReadmeCommandMode | undefined;
  let version: string | undefined;
  let binary: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--mode") {
      const value = argv[++i];
      if (value !== "fixture-assets" && value !== "published-assets") {
        throw new Error(`invalid --mode: ${value ?? "(missing)"}`);
      }
      mode = value;
      continue;
    }
    if (arg === "--version") {
      version = argv[++i];
      if (!version) throw new Error("--version requires a semver value");
      continue;
    }
    if (arg === "--binary") {
      binary = argv[++i];
      if (!binary) throw new Error("--binary requires a path");
      continue;
    }
    if (arg === "-h" || arg === "--help") usage();
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!mode || !version || !binary) usage();
  return { mode, version, binary };
}

async function main(): Promise<void> {
  const { mode, version, binary } = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(import.meta.dirname, "..");
  const report = await verifyReadmeCommands({
    mode,
    version,
    binaryPath: resolve(repoRoot, binary),
    repoRoot,
  });

  console.log(JSON.stringify(report, null, 2));

  if (!allReadmeCommandsPassed(report)) {
    const failed = report.commands.filter((c) => !c.passed);
    console.error(
      `[readme-commands] FAILED: ${failed.map((c) => `${c.id}(exit=${c.exitCode})`).join(", ")}`,
    );
    process.exit(1);
  }

  console.error(
    `[readme-commands] OK: ${report.commands.length} commands passed (mode=${report.mode}, version=${report.version})`,
  );
}

main().catch((error: unknown) => {
  console.error(`[readme-commands] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
