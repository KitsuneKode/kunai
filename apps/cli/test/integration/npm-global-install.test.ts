import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import packageJson from "../../package.json" with { type: "json" };

// Real, isolated npm global-install lifecycle for @kitsunekode/kunai.
//
// This proves the published tarball actually ships and runs the postinstall
// registration hook: a clean `npm install -g` must write install.json with
// channel "npm-global", `kunai --version` must report the npm-global channel,
// `kunai upgrade --check` must route through the npm channel, and
// `kunai uninstall` must delegate to the package manager (not native deletion).
//
// Heavy and network-dependent (npm resolves runtime deps from the registry), so
// it is gated behind KUNAI_NPM_GLOBAL_INSTALL=1 — the `test:npm-global-install`
// script sets it. The default suite (`bun run test`) skips it.

const CLI_ROOT = join(import.meta.dirname, "../..");
const POSTINSTALL_ARTIFACT = join(CLI_ROOT, "dist/postinstall.js");
const NPM_BUNDLE_ARTIFACT = join(CLI_ROOT, "dist/kunai.js");

const RUN_INSTALL = process.env.KUNAI_NPM_GLOBAL_INSTALL === "1";

function npmAvailable(): boolean {
  return spawnSync("npm", ["--version"], { encoding: "utf8" }).status === 0;
}

const describeInstall = RUN_INSTALL && npmAvailable() ? describe : describe.skip;

describeInstall("npm global install lifecycle", () => {
  let workDir = "";
  let homeDir = "";
  let configHome = "";
  let prefix = "";
  let binPath = "";
  let installEnv: NodeJS.ProcessEnv = process.env;

  function runKunai(args: readonly string[]): { status: number | null; output: string } {
    const result = spawnSync(binPath, [...args], { encoding: "utf8", env: installEnv });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  beforeAll(async () => {
    // The tarball packs whatever is in dist/. Ensure a fresh release build so the
    // bundled postinstall artifact exists before packing.
    if (!existsSync(POSTINSTALL_ARTIFACT) || !existsSync(NPM_BUNDLE_ARTIFACT)) {
      const build = spawnSync("bun", ["run", "build"], { cwd: CLI_ROOT, encoding: "utf8" });
      if (build.status !== 0) {
        throw new Error(`[npm-global-install] build failed:\n${build.stdout}\n${build.stderr}`);
      }
    }

    workDir = await mkdtemp(join(tmpdir(), "kunai-npm-global-"));
    homeDir = join(workDir, "home");
    configHome = join(homeDir, ".config");
    prefix = join(workDir, "npm-prefix");
    binPath = join(prefix, "bin", "kunai");

    for (const dir of [homeDir, configHome, prefix, join(workDir, "npm-cache")]) {
      mkdirSync(dir, { recursive: true });
    }

    installEnv = {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: join(homeDir, ".local", "share"),
      XDG_CACHE_HOME: join(homeDir, ".cache"),
      npm_config_cache: join(workDir, "npm-cache"),
      npm_config_prefix: prefix,
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      npm_config_audit: "false",
    };
  }, 300_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  test("ships and runs the postinstall hook end to end", async () => {
    // `bun pm pack` resolves `catalog:` dependency specifiers to real versions,
    // matching the release path (`bun publish`). Plain `npm pack` leaves
    // `catalog:` in place, which npm cannot install. `--ignore-scripts` keeps the
    // prepack build from re-running over the dist/ we already produced.
    const pack = spawnSync(
      "bun",
      ["pm", "pack", "--ignore-scripts", "--quiet", "--destination", workDir],
      { cwd: CLI_ROOT, encoding: "utf8", env: installEnv },
    );
    expect(pack.status).toBe(0);

    const tarball = readdirSync(workDir).find((name) => name.endsWith(".tgz"));
    expect(tarball).toBeDefined();
    const tarballPath = join(workDir, tarball as string);

    // Real global install WITH lifecycle scripts — this is what must run the hook.
    const install = spawnSync("npm", ["install", "-g", tarballPath], {
      encoding: "utf8",
      env: installEnv,
    });
    if (install.status !== 0) {
      throw new Error(`[npm-global-install] install failed:\n${install.stdout}\n${install.stderr}`);
    }
    expect(install.status).toBe(0);
    expect(existsSync(binPath)).toBe(true);

    // `kunai --version` runs and reports the package version + npm-global channel.
    const version = runKunai(["--version"]);
    expect(version.status).toBe(0);
    expect(version.output).toContain(packageJson.version);
    expect(version.output).toContain("npm-global");

    // The postinstall hook registered the install manifest.
    expect(await Bun.file(join(configHome, "kunai/install.json")).json()).toMatchObject({
      method: "npm-global",
      activeVersion: packageJson.version,
    });

    // `kunai upgrade --check` runs and routes through the npm channel (manifest
    // driven). Network may or may not resolve a latest version, so accept either
    // "up to date"/"update available"/"could not resolve", but never a foreign
    // channel's guidance (source checkout, packaged binary, bun global).
    const upgrade = runKunai(["upgrade", "--check"]);
    expect([0, 1]).toContain(upgrade.status ?? -1);
    expect(upgrade.output).not.toMatch(/Source checkout|Packaged binary|bun i -g|git pull/i);

    // Uninstall must delegate to the package manager (npm removes node_modules +
    // the bin launcher), not native file deletion.
    const packageDir = join(prefix, "lib", "node_modules", "@kitsunekode", "kunai");
    expect(existsSync(packageDir)).toBe(true);

    const uninstall = runKunai(["uninstall"]);
    expect(uninstall.status).toBe(0);
    expect(existsSync(packageDir)).toBe(false);
    expect(existsSync(binPath)).toBe(false);
    expect(existsSync(join(configHome, "kunai", "install.json"))).toBe(false);
  }, 300_000);
});
