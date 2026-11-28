import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix as posixPath, win32 as win32Path } from "node:path";

import { DesktopProfileError, resolveDesktopProfileDirs } from "@kunai/core/desktop-profile";
import { isJsonObject, isJsonString } from "@kunai/types";

export { DesktopProfileError };

export const PROFILE_MARKER = ".kunai-profile";
export const PROFILE_MARKER_CONTENT = "kunai-profile-v1\n";

export type StoragePlatform = "linux" | "darwin" | "win32";

export interface WindowsProfileFs {
  readonly lstat: (
    path: string,
  ) => { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean } | undefined;
  readonly realpathNative: (path: string) => string;
  /** Read a UTF-8 file, throwing when its byte length exceeds maxBytes. */
  readonly readFileUtf8: (path: string, maxBytes: number) => string;
}

export type WindowsProfileInference =
  | { readonly kind: "none"; readonly reason: "non-win32" | "env-override" | "non-matching-path" }
  | { readonly kind: "profile"; readonly profileDir: string }
  | { readonly kind: "normal-install"; readonly manifestPath: string }
  | { readonly kind: "ambiguous"; readonly error: DesktopProfileError };

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
  if (override) {
    assertDedicatedRoot(platform, override.profileDir, home, defaults, env.KUNAI_CONFIG_DIR);
    // A profile owns its launcher directory outright — an explicit bin
    // override that names anything else would split the layout the CLI
    // resolves from the same variable.
    const binDir = env.KUNAI_BIN_DIR;
    if (binDir !== undefined) {
      const path = platform === "win32" ? win32Path : posixPath;
      const bin = path.join(override.profileDir, "bin");
      const actual = path.normalize(binDir);
      const driveRootRelative = platform === "win32" && path.parse(binDir).root.length === 1;
      if (!path.isAbsolute(binDir) || driveRootRelative || path.relative(bin, actual) !== "") {
        throw new DesktopProfileError(
          binDir,
          `must equal ${JSON.stringify(bin)} while KUNAI_CONFIG_DIR is set`,
          "Unset KUNAI_BIN_DIR to use the profile launcher directory.",
          "KUNAI_BIN_DIR",
        );
      }
    }
  }
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
  displayRoot = root,
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
      displayRoot,
      "must not be a filesystem root, home directory, or ancestor of home",
    );
  }
  if (
    Object.values(defaults).some(
      (dir) => path.isAbsolute(dir) && (contains(root, dir) || contains(dir, root)),
    )
  ) {
    throw new DesktopProfileError(displayRoot, "overlaps a platform-default Kunai directory");
  }
}

function physicalPath(path: string): string {
  const native = process.platform === "win32" ? win32Path : posixPath;
  if (lstatSync(path, { throwIfNoEntry: false })) {
    // Bun's realpathSync() keeps an 8.3 alias on Windows; .native() expands it
    // so an alias-spelled override cannot compare short to long.
    return process.platform === "win32" ? realpathSync.native(path) : realpathSync(path);
  }
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
      env.KUNAI_CONFIG_DIR ?? profileDir,
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
  // Diagnostics name the spelling the user actually configured, not the
  // normalized path their shell resolved it to.
  const displayRoot = env.KUNAI_CONFIG_DIR ?? root;
  try {
    const defaults = defaultBaseDirs(platform, env, home);
    const rootStat = lstatSync(root, { throwIfNoEntry: false });
    if (rootStat?.isSymbolicLink()) {
      throw new DesktopProfileError(displayRoot, "must not be a symlink");
    }
    if (rootStat && !rootStat.isDirectory()) {
      throw new DesktopProfileError(displayRoot, "is not a regular directory");
    }
    assertDedicatedRoot(
      platform,
      physicalPath(root),
      physicalPath(home),
      {
        configDir: physicalPath(defaults.configDir),
        dataDir: physicalPath(defaults.dataDir),
        cacheDir: physicalPath(defaults.cacheDir),
        tempDir: physicalPath(defaults.tempDir),
      },
      env.KUNAI_CONFIG_DIR,
    );
    for (const child of ["config", "data", "cache", "tmp", "bin"]) {
      const stat = lstatSync(join(root, child), { throwIfNoEntry: false });
      if (stat && !stat.isDirectory()) {
        throw new DesktopProfileError(displayRoot, `has a non-directory or symlink at ${child}`);
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
      throw new DesktopProfileError(
        displayRoot,
        `has no valid ${PROFILE_MARKER} ownership marker`,
        "Use a profile already owned by Kunai, or install into a new, empty directory.",
      );
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
    throw new DesktopProfileError(displayRoot, "could not be checked or initialized");
  }
}

const WINDOWS_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const WINDOWS_INSTALL_MANIFEST_MAX_BYTES = 64 * 1024;
const WINDOWS_PROFILE_INFERENCE_HINT =
  "Set KUNAI_CONFIG_DIR to a dedicated Kunai profile, or reinstall Kunai.";

type WindowsVersionedExecutableLayout = {
  readonly executablePath: string;
  readonly root: string;
  readonly versionsDir: string;
  readonly versionDir: string;
  readonly version: string;
};

function normalizeWindowsPath(path: string): string {
  return win32Path.normalize(path).replaceAll("/", "\\");
}

function comparableWindowsPath(path: string): string {
  return normalizeWindowsPath(path).toLowerCase();
}

function sameWindowsPath(left: string, right: string): boolean {
  return comparableWindowsPath(left) === comparableWindowsPath(right);
}

function parseWindowsVersionedExecutable(
  executablePath: string,
): WindowsVersionedExecutableLayout | undefined {
  const normalized = normalizeWindowsPath(executablePath);
  if (!win32Path.isAbsolute(normalized) || win32Path.parse(normalized).root.length === 1) {
    return undefined;
  }
  if (win32Path.basename(normalized).toLowerCase() !== "kunai.exe") return undefined;
  const versionDir = win32Path.dirname(normalized);
  const version = win32Path.basename(versionDir);
  if (!WINDOWS_VERSION_RE.test(version)) return undefined;
  const versionsDir = win32Path.dirname(versionDir);
  if (win32Path.basename(versionsDir).toLowerCase() !== "versions") return undefined;
  const dataDir = win32Path.dirname(versionsDir);
  if (win32Path.basename(dataDir).toLowerCase() !== "data") return undefined;
  return {
    executablePath: normalized,
    root: win32Path.dirname(dataDir),
    versionsDir,
    versionDir,
    version,
  };
}

function readUtf8Bounded(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const bytesRead = readSync(fd, buffer, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes`);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

const nodeWindowsProfileFs: WindowsProfileFs = {
  lstat: (path) => lstatSync(path, { throwIfNoEntry: false }),
  realpathNative: (path) => realpathSync.native(path),
  readFileUtf8: readUtf8Bounded,
};

function windowsProfileAmbiguous(root: string, reason: string): DesktopProfileError {
  return new DesktopProfileError(root, reason, WINDOWS_PROFILE_INFERENCE_HINT);
}

function physicalWindowsPath(fs: WindowsProfileFs, path: string): string {
  return normalizeWindowsPath(fs.realpathNative(normalizeWindowsPath(path)));
}

function realVersionedExecutableExists(
  layout: WindowsVersionedExecutableLayout,
  fs: WindowsProfileFs,
): boolean {
  const versions = fs.lstat(layout.versionsDir);
  const version = fs.lstat(layout.versionDir);
  const executable = fs.lstat(layout.executablePath);
  return Boolean(
    versions &&
    !versions.isSymbolicLink() &&
    versions.isDirectory() &&
    version &&
    !version.isSymbolicLink() &&
    version.isDirectory() &&
    executable &&
    !executable.isSymbolicLink() &&
    executable.isFile(),
  );
}

function windowsMarkerState(
  root: string,
  fs: WindowsProfileFs,
): "missing" | "invalid-type" | "invalid-bytes" | "valid" {
  const marker = win32Path.join(root, PROFILE_MARKER);
  const stat = fs.lstat(marker);
  if (!stat) return "missing";
  if (stat.isSymbolicLink() || !stat.isFile()) return "invalid-type";
  try {
    return fs.readFileUtf8(marker, Buffer.byteLength(PROFILE_MARKER_CONTENT, "utf8")) ===
      PROFILE_MARKER_CONTENT
      ? "valid"
      : "invalid-bytes";
  } catch {
    return "invalid-bytes";
  }
}

function classifyOwnedWindowsProfile(
  layout: WindowsVersionedExecutableLayout,
  fs: WindowsProfileFs,
): WindowsProfileInference {
  const physicalRoot = physicalWindowsPath(fs, layout.root);
  const physicalExecutable = physicalWindowsPath(fs, layout.executablePath);
  const expected = win32Path.join(physicalRoot, "data", "versions", layout.version, "kunai.exe");
  if (!sameWindowsPath(expected, physicalExecutable)) {
    return {
      kind: "ambiguous",
      error: windowsProfileAmbiguous(
        layout.root,
        "has a valid profile marker, but this executable does not resolve inside its owned version store",
      ),
    };
  }
  return { kind: "profile", profileDir: physicalRoot };
}

function classifyDefaultWindowsInstall(
  layout: WindowsVersionedExecutableLayout,
  env: Readonly<Record<string, string | undefined>>,
  fs: WindowsProfileFs,
): WindowsProfileInference {
  const home = profileHome("win32", env);
  const manifestPath = win32Path.join(
    defaultBaseDirs("win32", env, home).configDir,
    "install.json",
  );
  const ambiguous = (detail: string): WindowsProfileInference => ({
    kind: "ambiguous",
    error: windowsProfileAmbiguous(
      layout.root,
      `has no ${PROFILE_MARKER} ownership marker, and the default install.json ${detail}`,
    ),
  });

  const stat = fs.lstat(manifestPath);
  if (!stat) return ambiguous("was not found");
  if (stat.isSymbolicLink() || !stat.isFile()) return ambiguous("is not a regular file");

  let text: string;
  try {
    text = fs.readFileUtf8(manifestPath, WINDOWS_INSTALL_MANIFEST_MAX_BYTES);
  } catch {
    return ambiguous("is unreadable or larger than 64 KiB");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return ambiguous("is not valid JSON");
  }
  if (!isJsonObject(parsed)) {
    return ambiguous("is not a JSON object");
  }
  const method = isJsonString(parsed.method) ? parsed.method : parsed.channel;
  if (method !== "binary") return ambiguous("does not describe a binary install");
  const versionedPath =
    isJsonString(parsed.versionedPath) && parsed.versionedPath
      ? parsed.versionedPath
      : isJsonString(parsed.versionPath) && parsed.versionPath
        ? parsed.versionPath
        : undefined;
  if (!versionedPath) return ambiguous("has no versionedPath or schema-1 versionPath");

  const physicalExecutable = normalizeWindowsPath(fs.realpathNative(layout.executablePath));
  const physicalVersioned = normalizeWindowsPath(fs.realpathNative(versionedPath));
  if (sameWindowsPath(physicalVersioned, physicalExecutable)) {
    return { kind: "normal-install", manifestPath };
  }
  // Installer smoke checks run the newly copied payload before install.json
  // flips activeVersion. The old manifest still proves ownership of the shared
  // physical versions directory, so a sibling new version is the same install.
  const executableVersionsDir = win32Path.dirname(win32Path.dirname(physicalExecutable));
  const manifestVersionsDir = win32Path.dirname(win32Path.dirname(physicalVersioned));
  if (sameWindowsPath(executableVersionsDir, manifestVersionsDir)) {
    return { kind: "normal-install", manifestPath };
  }
  return ambiguous("does not name this executable or a sibling in its versions directory");
}

/** Classify a Windows payload without mutating the environment or filesystem. */
export function classifyWindowsExecutableProfile(input: {
  readonly executablePath: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fs?: WindowsProfileFs;
}): WindowsProfileInference {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") return { kind: "none", reason: "non-win32" };
  const env = input.env ?? process.env;
  if (env.KUNAI_CONFIG_DIR !== undefined) return { kind: "none", reason: "env-override" };
  const layout = parseWindowsVersionedExecutable(input.executablePath);
  if (!layout) return { kind: "none", reason: "non-matching-path" };
  const fs = input.fs ?? nodeWindowsProfileFs;

  try {
    if (!realVersionedExecutableExists(layout, fs)) {
      return {
        kind: "ambiguous",
        error: windowsProfileAmbiguous(
          layout.root,
          "has the shape of a Kunai version store, but versions, the version directory, or kunai.exe is missing, symlinked, or not the expected file type",
        ),
      };
    }

    const marker = windowsMarkerState(layout.root, fs);
    if (marker === "invalid-type") {
      return {
        kind: "ambiguous",
        error: windowsProfileAmbiguous(
          layout.root,
          `has a ${PROFILE_MARKER} entry, but it is not a regular file`,
        ),
      };
    }
    if (marker === "invalid-bytes") {
      return {
        kind: "ambiguous",
        error: windowsProfileAmbiguous(
          layout.root,
          `has a ${PROFILE_MARKER} file, but its bytes do not match the Kunai profile ownership marker`,
        ),
      };
    }
    if (marker === "valid") return classifyOwnedWindowsProfile(layout, fs);
    return classifyDefaultWindowsInstall(layout, env, fs);
  } catch (error) {
    if (error instanceof DesktopProfileError) return { kind: "ambiguous", error };
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "ambiguous",
      error: windowsProfileAmbiguous(
        layout.root,
        `could not be inspected safely as a profile or native install (${detail})`,
      ),
    };
  }
}

/** Infer the Windows profile only from a real payload in its owned version store. */
export function inferWindowsProfileFromExecutable(
  executablePath = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const classification = classifyWindowsExecutableProfile({ executablePath, env });
  if (classification.kind === "profile") return classification.profileDir;
  if (classification.kind === "ambiguous") throw classification.error;
  return undefined;
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
