import { posix, win32 } from "node:path";

export class DesktopProfileError extends Error {
  constructor(
    value: string,
    reason: string,
    hint = "Set an absolute path to a dedicated Kunai profile or unset it to use the default profile.",
    variable = "KUNAI_CONFIG_DIR",
  ) {
    super(`${variable}="${value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "?")}" ${reason}. ${hint}`);
  }
}

/** Resolve the dedicated profile selected by KUNAI_CONFIG_DIR for a desktop host. */
export function resolveDesktopProfileDirs(
  platform: "linux" | "darwin" | "win32",
  override: string | undefined,
) {
  if (override === undefined) return undefined;
  const path = platform === "win32" ? win32 : posix;
  const driveRootRelative = platform === "win32" && path.parse(override).root.length === 1;
  if (!path.isAbsolute(override) || driveRootRelative) {
    throw new DesktopProfileError(override, "is not absolute");
  }
  const profileDir = path.resolve(override);
  if (
    /[\r\n\0]/.test(override) ||
    (platform === "win32" &&
      (/^\\\\[?.]\\/.test(profileDir) ||
        profileDir
          .slice(path.parse(profileDir).root.length)
          .split("\\")
          .some((part) => part.includes(":") || /[ .]$/.test(part))))
  ) {
    throw new DesktopProfileError(override, "uses an unsupported path spelling");
  }
  return {
    profileDir,
    configDir: path.join(profileDir, "config"),
    dataDir: path.join(profileDir, "data"),
    cacheDir: path.join(profileDir, "cache"),
    tempDir: path.join(profileDir, "tmp"),
  };
}
