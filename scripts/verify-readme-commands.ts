#!/usr/bin/env bun
// =============================================================================
// verify-readme-commands.ts — run the exact README Quick Start commands.
//
// Usage:
//   bun run scripts/verify-readme-commands.ts -- \
//     --mode fixture-assets --version 0.3.0 \
//     --binary apps/cli/dist/bin/kunai-linux-x64
// =============================================================================

import { readFileSync } from "node:fs";
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

  if (!mode && version && binary) usage();
  return { mode, version, binary };
}

/**
 * Defaults for a bare `bun run verify:readme:commands`.
 *
 * The root package script passes no arguments, so before this the command
 * exited 2 on every invocation while looking like working coverage — and no
 * doc anywhere showed the argument form. Defaults are derived rather than
 * hardcoded: the version comes from the CLI manifest, which is the same source
 * the release notes use, and the binary from the host build path.
 *
 * Anything still missing produces the usage message naming what to run, rather
 * than a bare exit code.
 */
function withDefaults(parsed: { mode?: ReadmeCommandMode; version?: string; binary?: string }): {
  mode: ReadmeCommandMode;
  version: string;
  binary: string;
} {
  const repoRoot = resolve(import.meta.dirname, "..");
  // Synchronous on purpose: `BunFile.json()` is async, and an un-awaited read
  // here silently yields `undefined` — which is indistinguishable from a
  // manifest that has no version, and fails the same way.
  let version = parsed.version;
  if (version === undefined) {
    try {
      const raw = readFileSync(resolve(repoRoot, "apps/cli/package.json"), "utf8");
      version = (JSON.parse(raw) as { version?: string }).version;
    } catch {
      version = undefined;
    }
  }
  const binary =
    parsed.binary ??
    `apps/cli/dist/bin/kunai-${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;

  if (!version || !Bun.file(resolve(repoRoot, binary)).exists()) {
    console.error(
      `verify:readme:commands needs a host binary to drive.\n` +
        `  Build one:  bun run build:binary:host\n` +
        `  Or pass it:  bun run verify:readme:commands -- --mode fixture-assets --version <semver> --binary <path>\n`,
    );
    process.exit(2);
  }
  return { mode: parsed.mode ?? "fixture-assets", version, binary };
}

async function main(): Promise<void> {
  const { mode, version, binary } = withDefaults(parseArgs(process.argv.slice(2)));
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
