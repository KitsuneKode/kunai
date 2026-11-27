import { posix, win32 } from "node:path";

/** Resolve the dedicated profile selected by KUNAI_CONFIG_DIR for a desktop host. */
export function resolveDesktopProfileDirs(
  platform: "linux" | "darwin" | "win32",
  override: string | undefined,
) {
  if (override === undefined) return undefined;
  const path = platform === "win32" ? win32 : posix;
  const driveRootRelative = platform === "win32" && path.parse(override).root.length === 1;
  if (!path.isAbsolute(override) || driveRootRelative) {
    throw new Error("KUNAI_CONFIG_DIR must be an absolute path to a Kunai profile directory");
  }
  const profileDir = path.normalize(override);
  return {
    profileDir,
    configDir: path.join(profileDir, "config"),
    dataDir: path.join(profileDir, "data"),
    cacheDir: path.join(profileDir, "cache"),
    tempDir: path.join(profileDir, "tmp"),
  };
}
