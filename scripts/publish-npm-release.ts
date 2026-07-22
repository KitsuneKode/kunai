#!/usr/bin/env bun
/**
 * Publish the npm release in the only order that is safe.
 *
 * `@kitsunekode/kunai` declares each `@kitsunekode/kunai-<target>` as an
 * optionalDependency pinned to its exact version. If the launcher goes up first,
 * a user installing in that window resolves optional deps that do not exist yet
 * and lands on a CLI with no binary. So: platform packages first, launcher last.
 *
 * Refuses to publish on any version skew, because a launcher paired with
 * mismatched platform packages is the classic failure of this layout.
 *
 * Dry run by default. Pass `--yes` to actually publish.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI_ROOT = join(ROOT, "apps/cli");
const PLATFORM_DIR = join(CLI_ROOT, "dist/npm-platform");
const TARBALL = join(ROOT, ".release-candidate/kunai-npm.tgz");

const confirmed = process.argv.includes("--yes");

type Manifest = { readonly name: string; readonly version: string };

async function readManifest(path: string): Promise<Manifest> {
  return JSON.parse(await readFile(path, "utf8")) as Manifest;
}

function fail(message: string): never {
  console.error(`[publish] ${message}`);
  process.exit(1);
}

async function run(command: readonly string[]): Promise<void> {
  console.log(`[publish] ${confirmed ? "$" : "(dry-run) $"} ${command.join(" ")}`);
  if (!confirmed) return;
  const proc = Bun.spawn([...command], { stdout: "inherit", stderr: "inherit", cwd: ROOT });
  const code = await proc.exited;
  if (code !== 0) fail(`command failed with exit code ${code}: ${command.join(" ")}`);
}

async function main(): Promise<void> {
  const cli = await readManifest(join(CLI_ROOT, "package.json"));
  const optional = (
    JSON.parse(await readFile(join(CLI_ROOT, "package.json"), "utf8")) as {
      optionalDependencies?: Record<string, string>;
    }
  ).optionalDependencies;

  if (!optional || Object.keys(optional).length === 0) {
    fail(
      "apps/cli/package.json declares no optionalDependencies — nothing would resolve a binary.",
    );
  }
  if (!existsSync(PLATFORM_DIR)) {
    fail(`missing ${PLATFORM_DIR}. Run: bun run build:binaries && bun run build:npm-platform`);
  }
  if (!existsSync(TARBALL)) {
    fail(`missing ${TARBALL}. Run: bun run release:pack`);
  }

  // Every declared optional dependency must exist on disk at the exact version.
  const dirs = await readdir(PLATFORM_DIR);
  const built = new Map<string, string>();
  for (const dir of dirs) {
    const manifestPath = join(PLATFORM_DIR, dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = await readManifest(manifestPath);
    built.set(manifest.name, manifest.version);
  }

  const problems: string[] = [];
  for (const [name, range] of Object.entries(optional)) {
    const version = built.get(name);
    if (!version) {
      problems.push(`${name}: declared but not built`);
      continue;
    }
    if (version !== cli.version) {
      problems.push(`${name}: built ${version}, CLI is ${cli.version}`);
    }
    if (range !== cli.version) {
      problems.push(`${name}: pinned "${range}", CLI is ${cli.version}`);
    }
  }
  for (const name of built.keys()) {
    if (!(name in optional))
      problems.push(`${name}: built but not declared — it would be orphaned`);
  }

  if (problems.length > 0) {
    fail(
      `version skew between the launcher and its platform packages:\n  - ${problems.join("\n  - ")}`,
    );
  }

  console.log(`[publish] ${built.size} platform package(s) verified at ${cli.version}`);

  // Platform packages FIRST — the launcher is useless without them, and a user
  // installing between the two publishes must never see a launcher whose
  // optional dependencies do not resolve.
  for (const dir of dirs) {
    if (!existsSync(join(PLATFORM_DIR, dir, "package.json"))) continue;
    await run(["bun", "publish", join(PLATFORM_DIR, dir), "--access", "public"]);
  }

  await run(["bun", "publish", TARBALL, "--access", "public"]);

  console.log(
    confirmed
      ? `[publish] published ${cli.version}: ${built.size} platform package(s) then the launcher`
      : "[publish] dry run complete — re-run with --yes to publish",
  );
}

await main();
