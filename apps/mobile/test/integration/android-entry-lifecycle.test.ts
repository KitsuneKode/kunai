import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRuntimeModule } from "../../scripts/build-contract";

const MOBILE_ROOT = join(import.meta.dir, "../..");
const REPOSITORY_ROOT = join(MOBILE_ROOT, "../..");
const ENTRYPOINT = join(MOBILE_ROOT, "src/entry.ts");
const WORKSPACE_PACKAGE = /^@kunai\/([a-z-]+)$/;
// Generous enough that a slow runner never trips it, short enough that the
// suite fails fast when the host wedges. The bug this guards took forever, not
// a few extra seconds.
const EXIT_BUDGET_MS = 15_000;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function isolatedRoot(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Bundles the real entrypoint against the real Android composition. The Bionic
 * cross-compile needs a toolchain this leg does not have, but the lifecycle bug
 * this guards lives in the JavaScript, so a `bun`-target bundle reproduces it.
 */
async function bundleAndroidEntry(): Promise<string> {
  const outdir = await isolatedRoot("kunai-mobile-entry-");
  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    outdir,
    naming: "entry.js",
    target: "bun",
    packages: "bundle",
    env: "disable",
    define: { __KUNAI_MOBILE_VERSION__: JSON.stringify("0.0.0-lifecycle-test") },
    plugins: [
      {
        name: "kunai-mobile-runtime",
        setup(build) {
          build.onResolve({ filter: /^mobile:runtime$/ }, () => ({
            path: resolveRuntimeModule("android-arm64"),
          }));
          // Every workspace package publishes "." as ./src/index.ts. Pinning
          // that here keeps this leg from depending on which directory the
          // suite was launched from, which decides whether Bun finds the
          // workspace links through a symlink or its real path.
          build.onResolve({ filter: WORKSPACE_PACKAGE }, (args) => {
            const name = WORKSPACE_PACKAGE.exec(args.path)?.[1];
            return name === undefined
              ? undefined
              : { path: join(REPOSITORY_ROOT, "packages", name, "src/index.ts") };
          });
        },
      },
    ],
  });
  for (const log of result.logs) console.error(log);
  expect(result.success).toBe(true);
  return join(outdir, "entry.js");
}

/**
 * Runs the bundle with stdin held open for the whole run, which is what a real
 * Termux TTY looks like. Nothing is ever written to that pipe, so a host that
 * keeps an stdin reader alive after its work is done never exits.
 */
async function runWithOpenStdin(
  bundle: string,
  argv: readonly string[],
): Promise<{ readonly exitCode: number; readonly stdout: string }> {
  const home = await isolatedRoot("kunai-mobile-home-");
  const child = Bun.spawn([process.execPath, bundle, ...argv], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
    },
  });

  const timeout = setTimeout(() => child.kill("SIGKILL"), EXIT_BUDGET_MS);
  try {
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { exitCode, stdout };
  } finally {
    clearTimeout(timeout);
  }
}

describe("Android entrypoint lifecycle", () => {
  test("exits on every terminating path while stdin stays open", async () => {
    const bundle = await bundleAndroidEntry();

    for (const [argv, expected, copy] of [
      [["--help"], 0, "Usage: kunai-mobile"],
      [["--version"], 0, "Kunai mobile 0.0.0-lifecycle-test"],
      [["--not-a-flag"], 2, "Invalid mobile command."],
    ] as const) {
      const result = await runWithOpenStdin(bundle, argv);

      // SIGKILL surfaces as a negative code or 137; either means it wedged.
      expect({ argv, exitCode: result.exitCode }).toEqual({ argv, exitCode: expected });
      expect(result.stdout).toContain(copy);
    }
  }, 60_000);

  test("exits after a cancelled prompt while stdin stays open", async () => {
    const bundle = await bundleAndroidEntry();
    const home = await isolatedRoot("kunai-mobile-home-");
    const child = Bun.spawn(
      [
        process.execPath,
        bundle,
        "--host-proof",
        "--probe-url",
        "https://probe.invalid/status",
        "--media-url",
        "https://media.invalid/video.m3u8",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
        env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home },
      },
    );

    // Answer the prompt, then leave the pipe open exactly as a terminal would.
    child.stdin.write("0\n");
    child.stdin.flush();

    const timeout = setTimeout(() => child.kill("SIGKILL"), EXIT_BUDGET_MS);
    try {
      const [exitCode, stdout] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Kunai mobile host proof");
    } finally {
      clearTimeout(timeout);
    }
  }, 60_000);

  test("offers one cancel entry and no blank-padded prompt", async () => {
    const bundle = await bundleAndroidEntry();
    const home = await isolatedRoot("kunai-mobile-home-");
    const child = Bun.spawn(
      [
        process.execPath,
        bundle,
        "--host-proof",
        "--probe-url",
        "https://probe.invalid/status",
        "--media-url",
        "https://media.invalid/video.m3u8",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
        env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home },
      },
    );
    // Padded input is what a soft keyboard produces; it must not be rejected.
    child.stdin.write(" 0 \n");
    child.stdin.flush();

    const timeout = setTimeout(() => child.kill("SIGKILL"), EXIT_BUDGET_MS);
    try {
      const [exitCode, stdout] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain("Invalid selection");
      expect(stdout.match(/Cancel/gu)).toEqual(["Cancel"]);
    } finally {
      clearTimeout(timeout);
    }
  }, 60_000);
});
