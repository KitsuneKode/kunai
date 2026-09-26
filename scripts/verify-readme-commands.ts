#!/usr/bin/env bun
// =============================================================================
// verify-readme-commands.ts — run the exact README Quick Start commands.
//
// Usage:
//   bun run scripts/verify-readme-commands.ts -- \
//     --mode fixture-assets --version 0.3.0 \
//     --binary apps/cli/dist/bin/kunai-linux-x64
// =============================================================================

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  allReadmeCommandsPassed,
  verifyReadmeCommands,
  type ReadmeCommandMode,
} from "../apps/cli/test/integration/helpers/readme-command-harness";
import { isMuslEnvironmentSync } from "../apps/cli/src/services/update/native-installer/musl";
import { resolveHostReleaseBinaryTarget } from "../apps/cli/src/services/update/platform-assets";

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

/**
 * Bare `bun run verify:readme:commands` must do something real — the root
 * script passes no arguments, so it exited 2 for everyone who ran it while CI
 * (which passes the full arg form) looked covered. Defaults: fixture mode,
 * the CLI package's own version, and the host binary a local
 * `bun run build:binary:host` produces.
 */
export async function resolveDefaultInvocation(): Promise<{
  mode: ReadmeCommandMode;
  version: string;
  binary: string;
}> {
  const cliPackage = JSON.parse(
    await readFile(join(import.meta.dirname, "../apps/cli/package.json"), "utf8"),
  ) as { version?: string };
  if (!cliPackage.version) {
    throw new Error("could not read version from apps/cli/package.json");
  }
  const hostLibc =
    process.platform === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu";
  const target = resolveHostReleaseBinaryTarget({ libc: hostLibc });
  return {
    mode: "fixture-assets",
    version: cliPackage.version,
    binary: join("apps/cli/dist/bin", target.out),
  };
}

export function assertInvocationBinary(binary: string, repoRoot: string): void {
  if (!existsSync(resolve(repoRoot, binary))) {
    throw new Error(
      `no host binary at ${binary}. ` +
        `Build it first: bun run build:binary:host — or pass --binary <path>.`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = resolve(import.meta.dirname, "..");
  // Explicit args are validated by parseArgs (usage error on miss). With no
  // args the defaults apply, and the binary they resolve is checked here so the
  // message can say how to produce one.
  const { mode, version, binary } =
    argv.length === 0 ? await resolveDefaultInvocation() : parseArgs(argv);
  if (argv.length === 0) assertInvocationBinary(binary, repoRoot);
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

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[readme-commands] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
