import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix as posixPath, win32 as win32Path } from "node:path";

import { DesktopProfileError, resolveDesktopProfileDirs } from "@kunai/core/desktop-profile";

export { DesktopProfileError };

export const PROFILE_MARKER = ".kunai-profile";
export const PROFILE_MARKER_CONTENT = "kunai-profile-v1\n";

export type StoragePlatform = "linux" | "darwin" | "win32";

export interface KunaiPathOptions {
  readonly platform?: StoragePlatform;
  readonly env?: Record<string, string | undefined>;
  readonly homeDir?: string;
}

export interface KunaiPaths {
  /**
   * Set only when `KUNAI_CONFIG_DIR` names a dedicated Kunai profile root.
   * Its presence marks a self-contained profile — `<root>/config`,
   * `<root>/data`, `<root>/cache`, `<root>/tmp` — which callers use to pick
   * profile-local behaviour: the file credential vault (the OS vaults are
   * account-wide, not profile-isolated) and a profile-local installer bin.
   * Undefined for the platform-default layout.
   */
  readonly profileDir?: string;
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
  const home = profileHome(platform, env, options.homeDir);
  const defaults = defaultBaseDirs(platform, env, home);
  const override = resolveDesktopProfileDirs(platform, env.KUNAI_CONFIG_DIR);
  if (override) assertDedicatedRoot(platform, override.profileDir, home, defaults);
  const dirs = override ?? defaults;
  const join = joinerFor(platform);

  return {
    ...dirs,
    configPath: join(dirs.configDir, "config.json"),
    mpvBridgePath: join(dirs.configDir, "mpv", "kunai-bridge.lua"),
    dataDbPath: join(dirs.dataDir, "kunai-data.sqlite"),
    cacheDbPath: join(dirs.cacheDir, "kunai-cache.sqlite"),
    logPath: join(dirs.dataDir, "logs.txt"),
  };
}

function assertDedicatedRoot(
  platform: StoragePlatform,
  root: string,
  home: string,
  defaults: Pick<KunaiPaths, "configDir" | "dataDir" | "cacheDir" | "tempDir">,
): void {
  const path = platform === "win32" ? win32Path : posixPath;
  // Windows is always case-insensitive; macOS defaults to a case-insensitive
  // volume — compare lowered so `users/x` cannot alias `Users/x`.
  const lower = platform === "darwin" || platform === "win32";
  const contains = (parent: string, child: string) => {
    const relative = path.relative(
      lower ? parent.toLowerCase() : parent,
      lower ? child.toLowerCase() : child,
    );
    return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  };
  if (contains(root, path.parse(root).root) || (path.isAbsolute(home) && contains(root, home))) {
    throw new DesktopProfileError(
      root,
      "must not be a filesystem root, home directory, or ancestor of home",
    );
  }
  if (
    Object.values(defaults).some(
      (dir) => path.isAbsolute(dir) && (contains(root, dir) || contains(dir, root)),
    )
  ) {
    throw new DesktopProfileError(root, "overlaps a platform-default Kunai directory");
  }
}

function physicalPath(path: string): string {
  const native = process.platform === "win32" ? win32Path : posixPath;
  if (lstatSync(path, { throwIfNoEntry: false })) return realpathSync(path);
  const parent = native.dirname(path);
  return parent === path ? path : native.join(physicalPath(parent), native.basename(path));
}

/** Check on-disk ownership before using or purging a desktop override. */
export function checkDesktopProfile(
  mode: "prepare" | "inspect" | "require",
  expectedRoot?: string,
): void {
  const platform = normalizePlatform(process.platform);
  const env = process.env;
  const { profileDir } = getKunaiPaths();
  if (profileDir === undefined) {
    if (expectedRoot !== undefined) {
      throw new DesktopProfileError(expectedRoot, "is not the resolved profile root");
    }
    return;
  }
  if (expectedRoot !== undefined && profileDir !== expectedRoot) {
    throw new DesktopProfileError(
      profileDir,
      `does not match expected profile root ${expectedRoot}`,
    );
  }
  checkProfileOwnership(profileDir, mode, platform, env);
}

function checkProfileOwnership(
  root: string,
  mode: "prepare" | "inspect" | "require",
  platform: StoragePlatform,
  env: NodeJS.ProcessEnv,
): void {
  const join = joinerFor(platform);
  const home = profileHome(platform, env);
  try {
    const defaults = defaultBaseDirs(platform, env, home);
    assertDedicatedRoot(platform, physicalPath(root), physicalPath(home), {
      configDir: physicalPath(defaults.configDir),
      dataDir: physicalPath(defaults.dataDir),
      cacheDir: physicalPath(defaults.cacheDir),
      tempDir: physicalPath(defaults.tempDir),
    });
    const rootStat = lstatSync(root, { throwIfNoEntry: false });
    if (rootStat && !rootStat.isDirectory()) {
      throw new DesktopProfileError(root, "is not a regular directory");
    }
    for (const child of ["config", "data", "cache", "tmp", "bin"]) {
      const stat = lstatSync(join(root, child), { throwIfNoEntry: false });
      if (stat && !stat.isDirectory()) {
        throw new DesktopProfileError(root, `has a non-directory or symlink at ${child}`);
      }
    }
    const marker = join(root, PROFILE_MARKER);
    const ownsRoot = () =>
      lstatSync(marker, { throwIfNoEntry: false })?.isFile() &&
      readFileSync(marker, "utf8") === PROFILE_MARKER_CONTENT;
    if (ownsRoot()) return;
    if (mode === "require" || (rootStat && readdirSync(root).length > 0)) {
      // Another Kunai process may have marked the previously empty root.
      if (ownsRoot()) return;
      throw new DesktopProfileError(root, `has no valid ${PROFILE_MARKER} ownership marker`);
    }
    if (mode === "inspect") return;
    mkdirSync(root, { recursive: true });
    try {
      writeFileSync(marker, PROFILE_MARKER_CONTENT, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!ownsRoot()) throw error;
    }
  } catch (error) {
    if (error instanceof DesktopProfileError) throw error;
    throw new DesktopProfileError(root, "could not be checked or initialized");
  }
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

function profileHome(
  platform: StoragePlatform,
  env: Record<string, string | undefined>,
  homeDir?: string,
): string {
  const home =
    platform === "win32"
      ? firstNonEmpty(env.USERPROFILE, env.HOME)
      : firstNonEmpty(env.HOME, env.USERPROFILE);
  return homeDir ?? home ?? homedir();
}

function defaultBaseDirs(
  platform: StoragePlatform,
  env: Record<string, string | undefined>,
  home: string,
): Pick<KunaiPaths, "configDir" | "dataDir" | "cacheDir" | "tempDir"> {
  // `homedir()` is the last resort, not the first. On Linux the XDG variables
  // below already override every root, and on Windows APPDATA/LOCALAPPDATA do —
  // but the macOS layout derives *everything* from `home`, and Bun's `homedir()`
  // reads the account record rather than `HOME`. That left macOS with no way to
  // redirect its storage root from the environment at all: a test that set the
  // documented variables still resolved the real `~/Library/Application Support`
  // and wrote the developer's live profile.
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
    const roaming = env.APPDATA || join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local");
    return {
      configDir: join(roaming, "kunai"),
      dataDir: join(local, "kunai"),
      cacheDir: join(local, "kunai"),
      tempDir: join(env.TEMP ?? env.TMP ?? tmpdir(), "kunai"),
    };
  }

  return {
    configDir: join(env.XDG_CONFIG_HOME || join(home, ".config"), "kunai"),
    dataDir: join(env.XDG_DATA_HOME || join(home, ".local", "share"), "kunai"),
    cacheDir: join(env.XDG_CACHE_HOME || join(home, ".cache"), "kunai"),
    tempDir: join(env.TMPDIR ?? tmpdir(), "kunai"),
  };
}
