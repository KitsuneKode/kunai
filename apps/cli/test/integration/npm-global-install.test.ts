import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import { isMuslEnvironmentSync } from "../../src/services/update/native-installer/musl";
import {
  RELEASE_BINARY_TARGETS,
  resolveHostReleaseBinaryTarget,
} from "../../src/services/update/platform-assets";

// This is intentionally an isolated, offline candidate gate. npm gets a
// launcher tarball and the host platform tarball in the same command; it must
// not fill missing optional dependencies from the public registry.
const CLI_ROOT = join(import.meta.dirname, "../..");
const REPO_ROOT = join(CLI_ROOT, "../..");
const NPM_PUBLISH_ROOT = join(CLI_ROOT, "dist/npm");
const NPM_PLATFORM_ROOT = join(CLI_ROOT, "dist/npm-platform");
const RUN_INSTALL = process.env.KUNAI_NPM_GLOBAL_INSTALL === "1";
const USE_PREBUILT_CANDIDATE = process.env.KUNAI_NPM_CANDIDATE_PREBUILT === "1";

describe("npm candidate isolation helpers", () => {
  test("uses the canonical temp prefix rather than a macOS /var alias", () => {
    const requestedPrefix = "/var/folders/abc/kunai/npm-prefix";
    const canonicalPrefix = "/private/var/folders/abc/kunai/npm-prefix";
    const installedBinary = "/private/var/folders/abc/kunai/npm-prefix/bin/kunai";

    expect(isPathWithin(requestedPrefix, installedBinary)).toBe(false);
    expect(isPathWithin(canonicalPrefix, installedBinary)).toBe(true);
    expect(
      isPathWithin(canonicalPrefix, "/private/var/folders/abc/kunai/npm-prefix-other/bin/kunai"),
    ).toBe(false);
  });

  test("removes ambient Node module-resolution injection", () => {
    expect(
      hermeticNodeEnvironment({
        NODE_OPTIONS: "--require /tmp/injected.cjs",
        NODE_PATH: "/tmp/ambient-node-modules",
        PRESERVED_VALUE: "yes",
      }),
    ).toEqual({ PRESERVED_VALUE: "yes", NODE_OPTIONS: undefined, NODE_PATH: undefined });
  });
});

function globalNodeModules(prefix: string): string {
  return join(prefix, process.platform === "win32" ? "node_modules" : "lib/node_modules");
}

function isPathWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

function hermeticNodeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, NODE_OPTIONS: undefined, NODE_PATH: undefined };
}

type PlatformManifest = {
  readonly name: string;
  readonly version: string;
};

function npmAvailable(): boolean {
  return spawnSync("npm", ["--version"], { encoding: "utf8" }).status === 0;
}

function commandOutput(result: SpawnSyncReturns<string>): string {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function expectCommand(
  label: string,
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `[npm-global-install] ${label} failed (${result.status ?? "signal"}):\n${commandOutput(result)}`,
    );
  }
  return result;
}

function packDirectory(packageDir: string, destination: string, env: NodeJS.ProcessEnv): string {
  mkdirSync(destination, { recursive: true });
  expectCommand(
    `pack ${packageDir}`,
    "npm",
    ["pack", "--ignore-scripts", "--offline", "--pack-destination", destination],
    { cwd: packageDir, env },
  );
  const tarballs = readdirSync(destination).filter((entry) => entry.endsWith(".tgz"));
  expect(tarballs).toHaveLength(1);
  const tarball = join(destination, tarballs[0] as string);
  expect(statSync(tarball).size).toBeGreaterThan(0);
  return tarball;
}

function hostTarget() {
  const libc = process.platform === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu";
  return resolveHostReleaseBinaryTarget({ libc });
}

function preservedPlatformTarball(targetId: string): string {
  const directory = join(REPO_ROOT, ".release-candidate", "npm-platform");
  const suffix = `-${targetId}-${packageJson.version}.tgz`;
  const matches = readdirSync(directory).filter(
    (entry) => entry.endsWith(suffix) && entry.endsWith(".tgz"),
  );
  expect(matches, targetId).toHaveLength(1);
  return join(directory, matches[0] as string);
}

const describeInstall = RUN_INSTALL ? describe : describe.skip;

describeInstall("hermetic npm candidate install", () => {
  let workDir = "";
  let prefix = "";
  let binPath = "";
  let launcherTarball = "";
  const platformTarballs = new Map<string, string>();
  let installEnv: NodeJS.ProcessEnv = process.env;

  beforeAll(async () => {
    if (!npmAvailable()) {
      throw new Error(
        "[npm-global-install] npm is required for KUNAI_NPM_GLOBAL_INSTALL=1; install npm and retry.",
      );
    }

    workDir = await mkdtemp(join(tmpdir(), "kunai-npm-candidate-"));
    const homeDir = join(workDir, "home");
    const packCache = join(workDir, "pack-cache");
    prefix = join(workDir, "npm-prefix");
    binPath = join(
      process.platform === "win32" ? prefix : join(prefix, "bin"),
      process.platform === "win32" ? "kunai.cmd" : "kunai",
    );

    for (const dir of [homeDir, packCache, prefix]) {
      mkdirSync(dir, { recursive: true });
    }

    // The pack cache is isolated too, but installation gets a separate fresh
    // empty cache below. A dead registry makes a regression fail locally rather
    // than accidentally reaching the public registry.
    installEnv = hermeticNodeEnvironment({
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: join(homeDir, ".config"),
      XDG_DATA_HOME: join(homeDir, ".local", "share"),
      XDG_CACHE_HOME: join(homeDir, ".cache"),
      npm_config_cache: packCache,
      npm_config_prefix: prefix,
      npm_config_registry: "http://127.0.0.1:9/",
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
    });

    if (USE_PREBUILT_CANDIDATE) {
      launcherTarball = join(REPO_ROOT, ".release-candidate", "kunai-npm.tgz");
      expect(existsSync(launcherTarball)).toBe(true);
      for (const target of RELEASE_BINARY_TARGETS) {
        platformTarballs.set(target.id, preservedPlatformTarball(target.id));
      }
    } else {
      expectCommand("build launcher", "bun", ["run", "build"], {
        cwd: CLI_ROOT,
        env: installEnv,
      });
      expectCommand("build platform binaries", "bun", ["run", "build:binaries"], {
        cwd: CLI_ROOT,
        env: installEnv,
      });
      expectCommand("write platform package manifests", "bun", ["run", "build:npm-platform"], {
        cwd: CLI_ROOT,
        env: installEnv,
      });

      launcherTarball = packDirectory(NPM_PUBLISH_ROOT, join(workDir, "launcher"), installEnv);
      for (const target of RELEASE_BINARY_TARGETS) {
        const packageDir = join(NPM_PLATFORM_ROOT, target.id);
        const tarball = packDirectory(packageDir, join(workDir, "platform", target.id), installEnv);
        platformTarballs.set(target.id, tarball);
      }
    }
  }, 600_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  test("builds exact-version-pinned manifests and tarballs for all platform candidates", () => {
    expect(platformTarballs.size).toBe(RELEASE_BINARY_TARGETS.length);
    const launcherManifest = JSON.parse(
      readFileSync(join(NPM_PUBLISH_ROOT, "package.json"), "utf8"),
    ) as { optionalDependencies?: Record<string, string> };

    for (const target of RELEASE_BINARY_TARGETS) {
      const packageName = `@kitsunekode/kunai-${target.id}`;
      const manifest = JSON.parse(
        readFileSync(join(NPM_PLATFORM_ROOT, target.id, "package.json"), "utf8"),
      ) as PlatformManifest;
      expect(manifest).toMatchObject({ name: packageName, version: packageJson.version });
      expect(launcherManifest.optionalDependencies?.[packageName]).toBe(packageJson.version);

      const tarball = platformTarballs.get(target.id);
      expect(tarball, packageName).toBeDefined();
      expect(existsSync(tarball as string), packageName).toBe(true);
      expect(statSync(tarball as string).size, packageName).toBeGreaterThan(0);
      expect(tarball, packageName).toEndWith(`-${packageJson.version}.tgz`);
    }
  });

  test("installs and executes the host candidate from local tarballs only", () => {
    const target = hostTarget();
    const hostTarball = platformTarballs.get(target.id);
    expect(hostTarball).toBeDefined();

    const freshInstallCache = join(workDir, "install-cache");
    mkdirSync(freshInstallCache, { recursive: true });
    const install = expectCommand(
      "offline local-tarball install",
      "npm",
      [
        "install",
        "--global",
        "--ignore-scripts",
        "--offline",
        hostTarball as string,
        launcherTarball,
      ],
      {
        cwd: workDir,
        env: { ...installEnv, npm_config_cache: freshInstallCache },
      },
    );
    expect(install.status).toBe(0);
    expect(existsSync(binPath)).toBe(true);

    // The generated launcher has no vendored native fallback. Clearing Node's
    // resolution injection means this process can reach its native binary only
    // through the host platform package installed beneath this temporary prefix.
    const launchEnv = hermeticNodeEnvironment(installEnv);
    expect(launchEnv.NODE_PATH).toBeUndefined();
    expect(launchEnv.NODE_OPTIONS).toBeUndefined();
    const version = spawnSync(binPath, ["--version"], {
      encoding: "utf8",
      env: launchEnv,
      shell: process.platform === "win32",
    });
    expect(version.status, commandOutput(version)).toBe(0);
    expect(commandOutput(version)).toContain(packageJson.version);

    const installedLauncher = realpathSync(binPath);
    const installedBinary = realpathSync(
      join(
        globalNodeModules(prefix),
        "@kitsunekode",
        `kunai-${target.id}`,
        "bin",
        process.platform === "win32" ? "kunai.exe" : "kunai",
      ),
    );
    const canonicalPrefix = realpathSync(prefix);
    expect(isPathWithin(canonicalPrefix, installedLauncher)).toBe(true);
    expect(isPathWithin(canonicalPrefix, installedBinary)).toBe(true);
  }, 120_000);
});
