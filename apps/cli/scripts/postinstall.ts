#!/usr/bin/env bun
import { execSync } from "node:child_process";
// Writes install.json after a global npm install so `kunai upgrade` / `kunai uninstall`
// route correctly. Bun global installs are recorded by install.sh / install.ps1.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import packageJson from "../package.json" with { type: "json" };
import { writeInstallManifest } from "../src/services/update/install-manifest";

function globalNpmPrefix(): string | null {
  try {
    return execSync("npm prefix -g", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function isGlobalNpmInstall(packageDir: string): boolean {
  const prefix = globalNpmPrefix();
  if (!prefix) return false;
  return packageDir.startsWith(prefix);
}

const packageDir = dirname(import.meta.dirname);
if (!isGlobalNpmInstall(packageDir)) {
  process.exit(0);
}

const binName = process.platform === "win32" ? "kunai.cmd" : "kunai";
const binPath = join(globalNpmPrefix() ?? "", "bin", binName);
if (!existsSync(binPath) && !existsSync(join(globalNpmPrefix() ?? "", "bin", "kunai"))) {
  process.exit(0);
}

await writeInstallManifest({
  method: "npm-global",
  activeVersion: packageJson.version,
  launcherPath: existsSync(binPath) ? binPath : join(globalNpmPrefix() ?? "", "bin", "kunai"),
  downloadBaseUrl: "https://github.com/KitsuneKode/kunai/releases",
});
