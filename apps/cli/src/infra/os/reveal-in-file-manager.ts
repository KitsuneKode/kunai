import {
  defaultExternalOpenRuntime,
  openExternal,
  type ExternalOpenResult,
  type ExternalOpenRuntime,
} from "@/infra/os/external-open";

export type { ExternalOpenResult };

/**
 * Reveals `absolutePathToReveal` in the OS file manager.
 * Linux opens the parent directory; macOS uses `open -R`; Windows uses `explorer /select,`.
 */
export async function revealPathInOsFileManager(
  absolutePathToReveal: string,
  runtime: ExternalOpenRuntime = defaultExternalOpenRuntime,
): Promise<ExternalOpenResult> {
  return openExternal({ kind: "path", path: absolutePathToReveal }, runtime);
}
