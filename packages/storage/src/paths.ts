import { homedir, tmpdir } from "node:os";
import { posix as posixPath, win32 as win32Path } from "node:path";

export type StoragePlatform = "linux" | "darwin" | "win32";

export interface KunaiPathOptions {
  readonly platform?: StoragePlatform;
  readonly env?: Record<string, string | undefined>;
  readonly homeDir?: string;
}

export interface KunaiPaths {
  readonly configDir: string;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly tempDir: string;
  readonly configPath: string;
  /** mpv bridge script installed next to Kunai config (`configDir/mpv/kunai-bridge.lua`). */
  readonly mpvBridgePath: string;
  readonly dataDbPath: string;
  readonly cacheDbPath: string;
  readonly logPath: string;
}

/**
 * Join for the *target* platform rather than the host.
 *
 * `node:path.join` follows whatever OS is running, so asking for `win32` paths
 * from Linux produced mixed separators (`C:\Roaming/kunai/config.json`). That is
 * harmless in production -- the host and target always agree there -- but it
 * makes the `platform` option untrustworthy in tests, which is precisely where
 * Windows layout has to be verified from a Linux CI runner.
 */
export function joinerFor(platform: StoragePlatform): (...segments: string[]) => string {
  return platform === "win32" ? win32Path.join : posixPath.join;
}

/**
 * Same joiner keyed by a Node platform string, for callers that carry
 * `NodeJS.Platform` (the installer layout and package-inspection paths both do).
 * Exported so those callers stop reaching for `node:path` directly: `node:path`
 * always follows the *host*, so any function that accepts a target platform and
 * then joins with it silently disagrees with itself off that platform.
 */
export function joinerForNodePlatform(
  platform: NodeJS.Platform,
): (...segments: string[]) => string {
  return joinerFor(platform === "win32" ? "win32" : "linux");
}

export function getKunaiPaths(options: KunaiPathOptions = {}): KunaiPaths {
  const platform = options.platform ?? normalizePlatform(process.platform);
  const env = options.env ?? process.env;
  // `homedir()` is the last resort, not the first. On Linux the XDG variables
  // below already override every root, and on Windows APPDATA/LOCALAPPDATA do —
  // but the macOS layout derives *everything* from `home`, and Bun's `homedir()`
  // reads the account record rather than `HOME`. That left macOS with no way to
  // redirect its storage root from the environment at all: a test that set the
  // documented variables still resolved the real `~/Library/Application Support`
  // and wrote the developer's live profile.
  const home = options.homeDir ?? firstNonEmpty(env.HOME, env.USERPROFILE) ?? homedir();
  const join = joinerFor(platform);

  const dirs = getBaseDirs(platform, env, home);

  return {
    ...dirs,
    configPath: join(dirs.configDir, "config.json"),
    mpvBridgePath: join(dirs.configDir, "mpv", "kunai-bridge.lua"),
    dataDbPath: join(dirs.dataDir, "kunai-data.sqlite"),
    cacheDbPath: join(dirs.cacheDir, "kunai-cache.sqlite"),
    logPath: join(dirs.dataDir, "logs.txt"),
  };
}

function normalizePlatform(platform: NodeJS.Platform): StoragePlatform {
  if (platform === "darwin" || platform === "win32") {
    return platform;
  }

  return "linux";
}

/**
 * `??` treats an empty string as a value, not as absent.
 *
 * `HOME=""` therefore survived the fallback chain and became the storage root,
 * and every path joined from it came out relative to the process's working
 * directory rather than to a profile. An empty variable means "unset" here.
 */
function firstNonEmpty(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function getBaseDirs(
  platform: StoragePlatform,
  env: Record<string, string | undefined>,
  home: string,
): Pick<KunaiPaths, "configDir" | "dataDir" | "cacheDir" | "tempDir"> {
  const join = joinerFor(platform);

  if (platform === "darwin") {
    const applicationSupport = join(home, "Library", "Application Support", "kunai");
    return {
      configDir: applicationSupport,
      dataDir: applicationSupport,
      cacheDir: join(home, "Library", "Caches", "kunai"),
      tempDir: join(env.TMPDIR ?? tmpdir(), "kunai"),
    };
  }

  if (platform === "win32") {
    const roaming = env.APPDATA ?? join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return {
      configDir: join(roaming, "kunai"),
      dataDir: join(local, "kunai"),
      cacheDir: join(local, "kunai"),
      tempDir: join(env.TEMP ?? env.TMP ?? tmpdir(), "kunai"),
    };
  }

  return {
    configDir: join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "kunai"),
    dataDir: join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "kunai"),
    cacheDir: join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "kunai"),
    tempDir: join(env.TMPDIR ?? tmpdir(), "kunai"),
  };
}
