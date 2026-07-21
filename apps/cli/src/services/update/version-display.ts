import { existsSync } from "node:fs";

import { inspectInstallManifest } from "./install-manifest";
import { detectInstallMethod } from "./install-method";

/** Format `--version` output. Read-only: never migrates install.json. */
export async function formatVersionLine(version: string): Promise<string> {
  const inspection = await inspectInstallManifest();
  const manifest = inspection.status === "loaded" ? inspection.manifest : null;
  const channel = manifest?.method ?? detectInstallMethod({ fileExists: existsSync }).kind;
  const label = manifest?.method ? channel : `${channel} (detected)`;
  return `kunai ${version} (${label})`;
}
