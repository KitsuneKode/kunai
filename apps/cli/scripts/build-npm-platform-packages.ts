#!/usr/bin/env bun
import { existsSync } from "node:fs";
/**
 * Build the per-platform npm packages that back the `bin` launcher.
 *
 * The npm package published as `@kitsunekode/kunai` carries no binary: it is a
 * plain Node launcher (scripts/npm-launcher.mjs) that resolves one of these
 * packages at runtime. npm/bun/pnpm install exactly one, selected by the `os`,
 * `cpu` and `libc` fields, so a user downloads a single ~24-37MB (gzipped)
 * artifact rather than all of them.
 *
 * Reads the binaries produced by `build-binaries.ts` from dist/bin and writes
 * publishable package directories to dist/npm-platform.
 *
 * Versions are stamped from the CLI package.json. Skew between the launcher and
 * its platform packages is the classic failure of this layout, so the release
 * guard asserts they match before publish.
 */
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "../src/services/update/platform-assets";

const ROOT = join(import.meta.dirname, "..");
const BIN_DIR = join(ROOT, "dist/bin");
const OUT_DIR = join(ROOT, "dist/npm-platform");

type CliPackageJson = {
  readonly version: string;
  readonly license?: string;
  readonly repository?: unknown;
  readonly homepage?: string;
  readonly author?: unknown;
};

/** npm `os` values differ from our internal target ids for Windows. */
function npmOs(os: string): string {
  return os === "windows" ? "win32" : os;
}

async function main(): Promise<void> {
  const cli = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as CliPackageJson;

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const built: string[] = [];
  const missing: string[] = [];

  for (const target of RELEASE_BINARY_TARGETS) {
    const sourceBinary = join(BIN_DIR, target.out);
    if (!existsSync(sourceBinary)) {
      missing.push(target.id);
      continue;
    }

    const packageName = `@kitsunekode/kunai-${target.id}`;
    const packageDir = join(OUT_DIR, target.id);
    const binName = target.os === "windows" ? "kunai.exe" : "kunai";

    await mkdir(join(packageDir, "bin"), { recursive: true });
    await cp(sourceBinary, join(packageDir, "bin", binName));
    // npm preserves the mode from the tarball; without this the launcher's
    // spawn fails with EACCES on a fresh install.
    await chmod(join(packageDir, "bin", binName), 0o755);

    const manifest = {
      name: packageName,
      version: cli.version,
      description: `Kunai prebuilt binary for ${target.id}.`,
      license: cli.license ?? "MIT",
      ...(cli.repository ? { repository: cli.repository } : {}),
      ...(cli.homepage ? { homepage: cli.homepage } : {}),
      ...(cli.author ? { author: cli.author } : {}),
      os: [npmOs(target.os)],
      cpu: [target.arch],
      // `libc` is honored by npm 10.4+, pnpm and bun. Older npm ignores it and
      // may install a glibc build on musl; the launcher detects the mismatch at
      // runtime and prints the native-installer fallback rather than crashing.
      ...(target.os === "linux" ? { libc: [target.libc === "musl" ? "musl" : "glibc"] } : {}),
      files: ["bin/"],
      preferUnplugged: true,
    };

    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(packageDir, "README.md"),
      `# ${packageName}\n\n` +
        `Prebuilt Kunai binary for \`${target.id}\`.\n\n` +
        `This package is an implementation detail of [\`@kitsunekode/kunai\`](https://www.npmjs.com/package/@kitsunekode/kunai)` +
        ` and is installed automatically for your platform. Install the main package instead:\n\n` +
        "```sh\nnpm install -g @kitsunekode/kunai\n```\n",
      "utf8",
    );

    built.push(packageName);
  }

  if (built.length === 0) {
    console.error(
      `[npm-platform] no binaries found in ${BIN_DIR}. Run \`bun run build:binaries\` first.`,
    );
    process.exit(1);
  }

  for (const name of built) console.log(`[npm-platform] ${name}@${cli.version}`);
  if (missing.length > 0) {
    console.warn(
      `[npm-platform] skipped ${missing.length} target(s) with no binary: ${missing.join(", ")}`,
    );
  }
  console.log(`[npm-platform] wrote ${built.length} package(s) to ${OUT_DIR}`);
}

await main();
