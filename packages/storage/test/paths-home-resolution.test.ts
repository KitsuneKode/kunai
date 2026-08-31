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
    const paths = getKunaiPaths({ platform: "darwin", env: { HOME: "   " } });

    // Falls through to homedir(), so it is at least absolute rather than relative.
    expect(paths.configDir.startsWith("/")).toBe(true);
    expect(paths.configDir).not.toStartWith("   ");
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
