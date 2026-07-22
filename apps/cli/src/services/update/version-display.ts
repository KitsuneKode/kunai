import { existsSync } from "node:fs";

import { inspectInstallManifest } from "./install-manifest";
import { detectInstallMethod, type DetectInstallMethodInput } from "./install-method";

export type FormatVersionLineOptions = {
  readonly configDir?: string;
  readonly detectInstallMethodInput?: DetectInstallMethodInput;
};

/** Format `--version` output. Read-only: never migrates install.json. */
export async function formatVersionLine(
  version: string,
  options: FormatVersionLineOptions = {},
): Promise<string> {
  const inspection = await inspectInstallManifest(options.configDir);
  const manifest = inspection.status === "loaded" ? inspection.manifest : null;
  const channel =
    manifest?.method ??
    detectInstallMethod({
      fileExists: existsSync,
      ...options.detectInstallMethodInput,
    }).kind;
  const label = manifest?.method ? channel : `${channel} (detected)`;
  return `kunai ${version} (${label})`;
}
