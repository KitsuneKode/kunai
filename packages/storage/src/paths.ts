import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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
  readonly providerOverridesPath: string;
  /** mpv bridge script installed next to Kunai config (`configDir/mpv/kunai-bridge.lua`). */
  readonly mpvBridgePath: string;
  readonly dataDbPath: string;
  readonly cacheDbPath: string;
  readonly logPath: string;
}

export function getKunaiPaths(options: KunaiPathOptions = {}): KunaiPaths {
  const platform = options.platform ?? normalizePlatform(process.platform);
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();

  const dirs = getBaseDirs(platform, env, home);

  return {
    ...dirs,
    configPath: join(dirs.configDir, "config.json"),
    providerOverridesPath: join(dirs.configDir, "providers.json"),
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

function getBaseDirs(
  platform: StoragePlatform,
  env: Record<string, string | undefined>,
  home: string,
): Pick<KunaiPaths, "configDir" | "dataDir" | "cacheDir" | "tempDir"> {
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
