import { existsSync } from "node:fs";

import { readInstallManifest } from "./install-manifest";
import { detectInstallMethod } from "./install-method";

export async function formatVersionLine(version: string): Promise<string> {
  const manifest = await readInstallManifest();
  const channel = manifest?.channel ?? detectInstallMethod({ fileExists: existsSync }).kind;
  const label = manifest?.channel ? channel : `${channel} (detected)`;
  return `kunai ${version} (${label})`;
}
