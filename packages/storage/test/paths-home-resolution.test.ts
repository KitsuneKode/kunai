import { describe, expect, test } from "bun:test";

import { getKunaiPaths } from "../src/paths";

/**
 * Home resolution order, which is what makes a sandboxed run possible at all.
 *
 * Linux can be redirected with the XDG variables and Windows with
 * APPDATA/LOCALAPPDATA, but the macOS layout derives *every* root from home. If
 * home came only from `homedir()` — which reads the account record, not `HOME` —
 * then macOS had no way to be redirected from the environment, and a test that
 * set the documented variables still resolved the developer's real
 * `~/Library/Application Support/kunai` and wrote their live profile.
 */
describe("getKunaiPaths home resolution", () => {
  test("an explicit homeDir still outranks the environment", () => {
    const paths = getKunaiPaths({
      platform: "darwin",
      homeDir: "/Users/explicit",
      env: { HOME: "/Users/from-env" },
    });

    expect(paths.configDir).toBe("/Users/explicit/Library/Application Support/kunai");
  });

  test("macOS takes its roots from HOME when no homeDir is given", () => {
    const paths = getKunaiPaths({ platform: "darwin", env: { HOME: "/sandbox" } });

    expect(paths.configDir).toBe("/sandbox/Library/Application Support/kunai");
    expect(paths.dataDir).toBe("/sandbox/Library/Application Support/kunai");
    expect(paths.cacheDir).toBe("/sandbox/Library/Caches/kunai");
  });

  test("USERPROFILE stands in for HOME", () => {
    const paths = getKunaiPaths({ platform: "darwin", env: { USERPROFILE: "/sandbox" } });

    expect(paths.configDir).toBe("/sandbox/Library/Application Support/kunai");
  });

  test("HOME wins over USERPROFILE when both are set", () => {
    const paths = getKunaiPaths({
      platform: "darwin",
      env: { HOME: "/from-home", USERPROFILE: "/from-userprofile" },
    });

    expect(paths.configDir).toBe("/from-home/Library/Application Support/kunai");
  });

  test("an empty HOME is treated as unset, not as a root", () => {
    // `??` treats "" as a value, so `HOME=""` used to survive the fallback chain
    // and become the storage root — every path joined from it came out relative
    // to the working directory instead of a profile.
    const paths = getKunaiPaths({
      platform: "darwin",
      env: { HOME: "", USERPROFILE: "/sandbox" },
    });

    expect(paths.configDir).toBe("/sandbox/Library/Application Support/kunai");
  });

  test("whitespace-only HOME is also treated as unset", () => {
    // Every other case here supplies the whole environment so the result does
    // not depend on the host. The first version of this one let HOME fall
    // through to `homedir()` and asserted the result was absolute — which is
    // true on POSIX and false on a Windows runner, where `homedir()` is
    // `C:\Users\...`. Pin the fallback instead of the shape.
    const paths = getKunaiPaths({
      platform: "darwin",
      env: { HOME: "   ", USERPROFILE: "/sandbox" },
    });

    expect(paths.configDir).toBe("/sandbox/Library/Application Support/kunai");
  });

  test("Linux still prefers the XDG variables over home", () => {
    const paths = getKunaiPaths({
      platform: "linux",
      env: { HOME: "/sandbox", XDG_CONFIG_HOME: "/xdg/config" },
    });

    expect(paths.configDir).toBe("/xdg/config/kunai");
  });

  test("Linux falls back to HOME when XDG is unset", () => {
    const paths = getKunaiPaths({ platform: "linux", env: { HOME: "/sandbox" } });

    expect(paths.configDir).toBe("/sandbox/.config/kunai");
  });

  test("Windows still prefers APPDATA over home", () => {
    const paths = getKunaiPaths({
      platform: "win32",
      env: { USERPROFILE: "C:\\sandbox", APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local" },
    });

    expect(paths.configDir).toBe("C:\\Roaming\\kunai");
  });

  test("Windows falls back to the profile layout when APPDATA is unset", () => {
    const paths = getKunaiPaths({ platform: "win32", env: { USERPROFILE: "C:\\sandbox" } });

    expect(paths.configDir).toBe("C:\\sandbox\\AppData\\Roaming\\kunai");
  });
});

// Pin the full override layout on each target, even when its default roots are set.
describe("getKunaiPaths KUNAI_CONFIG_DIR profile root", () => {
  const PROFILE_CASES = [
    {
      platform: "linux",
      profile: "/sandbox/profile",
      env: {
        KUNAI_CONFIG_DIR: "/sandbox/profile",
        HOME: "/home/tester",
        USERPROFILE: "/home/tester",
        XDG_CONFIG_HOME: "/home/tester/.config",
        XDG_DATA_HOME: "/home/tester/.local/share",
        XDG_CACHE_HOME: "/home/tester/.cache",
      },
      expected: {
        configDir: "/sandbox/profile/config",
        dataDir: "/sandbox/profile/data",
        cacheDir: "/sandbox/profile/cache",
        tempDir: "/sandbox/profile/tmp",
        configPath: "/sandbox/profile/config/config.json",
        mpvBridgePath: "/sandbox/profile/config/mpv/kunai-bridge.lua",
        dataDbPath: "/sandbox/profile/data/kunai-data.sqlite",
        cacheDbPath: "/sandbox/profile/cache/kunai-cache.sqlite",
        logPath: "/sandbox/profile/data/logs.txt",
      },
    },
    {
      platform: "darwin",
      profile: "/Users/test/Profile With Spaces",
      env: {
        KUNAI_CONFIG_DIR: "/Users/test/Profile With Spaces",
        HOME: "/Users/test",
        USERPROFILE: "/Users/test",
        TMPDIR: "/var/folders/xx",
      },
      expected: {
        configDir: "/Users/test/Profile With Spaces/config",
        dataDir: "/Users/test/Profile With Spaces/data",
        cacheDir: "/Users/test/Profile With Spaces/cache",
        tempDir: "/Users/test/Profile With Spaces/tmp",
        configPath: "/Users/test/Profile With Spaces/config/config.json",
        mpvBridgePath: "/Users/test/Profile With Spaces/config/mpv/kunai-bridge.lua",
        dataDbPath: "/Users/test/Profile With Spaces/data/kunai-data.sqlite",
        cacheDbPath: "/Users/test/Profile With Spaces/cache/kunai-cache.sqlite",
        logPath: "/Users/test/Profile With Spaces/data/logs.txt",
      },
    },
    {
      platform: "win32",
      profile: "C:\\Sandbox\\Profile",
      env: {
        KUNAI_CONFIG_DIR: "C:\\Sandbox\\Profile",
        USERPROFILE: "C:\\Users\\test",
        HOME: "C:\\Users\\test",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      },
      expected: {
        configDir: "C:\\Sandbox\\Profile\\config",
        dataDir: "C:\\Sandbox\\Profile\\data",
        cacheDir: "C:\\Sandbox\\Profile\\cache",
        tempDir: "C:\\Sandbox\\Profile\\tmp",
        configPath: "C:\\Sandbox\\Profile\\config\\config.json",
        mpvBridgePath: "C:\\Sandbox\\Profile\\config\\mpv\\kunai-bridge.lua",
        dataDbPath: "C:\\Sandbox\\Profile\\data\\kunai-data.sqlite",
        cacheDbPath: "C:\\Sandbox\\Profile\\cache\\kunai-cache.sqlite",
        logPath: "C:\\Sandbox\\Profile\\data\\logs.txt",
      },
    },
  ] as const;

  for (const { platform, profile, env, expected } of PROFILE_CASES) {
    test(`${platform}: resolves every root under the profile`, () => {
      expect(getKunaiPaths({ platform, env })).toEqual({ profileDir: profile, ...expected });
    });
  }

  test("accepts a trailing separator", () => {
    const paths = getKunaiPaths({
      platform: "linux",
      env: { KUNAI_CONFIG_DIR: "/sandbox/profile/" },
    });

    expect(paths.configDir).toBe("/sandbox/profile/config");
    expect(paths.dataDbPath).toBe("/sandbox/profile/data/kunai-data.sqlite");
  });

  test.each(["linux", "darwin", "win32"] as const)(
    "%s: an empty override is a configuration error, not a fallthrough",
    (platform) => {
      expect(() => getKunaiPaths({ platform, env: { KUNAI_CONFIG_DIR: "" } })).toThrow(
        "KUNAI_CONFIG_DIR must be an absolute path to a Kunai profile directory",
      );
    },
  );

  test.each(["linux", "darwin", "win32"] as const)(
    "%s: a relative override is a configuration error",
    (platform) => {
      expect(() =>
        getKunaiPaths({ platform, env: { KUNAI_CONFIG_DIR: "relative/profile" } }),
      ).toThrow("KUNAI_CONFIG_DIR must be an absolute path to a Kunai profile directory");
    },
  );

  // `\foo` and `/foo` both resolve against the current drive — each parses
  // with a lone separator as its root, which is as non-absolute as `.\foo`
  // even though `isAbsolute` accepts the leading separator.
  test.each(["\\relative-to-drive", "/relative-to-drive"])(
    "win32: a drive-root-relative override is a configuration error (%s)",
    (override) => {
      expect(() =>
        getKunaiPaths({ platform: "win32", env: { KUNAI_CONFIG_DIR: override } }),
      ).toThrow("KUNAI_CONFIG_DIR must be an absolute path to a Kunai profile directory");
    },
  );

  test("win32: a UNC root is accepted as absolute", () => {
    const paths = getKunaiPaths({
      platform: "win32",
      env: { KUNAI_CONFIG_DIR: "\\\\server\\share\\kunai" },
    });

    expect(paths.profileDir).toBe("\\\\server\\share\\kunai");
    expect(paths.configDir).toBe("\\\\server\\share\\kunai\\config");
  });

  test("an unset override leaves profileDir absent", () => {
    const paths = getKunaiPaths({ platform: "linux", env: { HOME: "/sandbox" } });

    expect(paths.profileDir).toBeUndefined();
  });
});
