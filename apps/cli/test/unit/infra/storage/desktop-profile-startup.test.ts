import { describe, expect, test } from "bun:test";

import {
  prepareCliProfile,
  versionRequestSkipsWindowsProfileInference,
  type PrepareCliProfileDeps,
} from "@/infra/storage/desktop-profile-startup";
import { DesktopProfileError } from "@kunai/storage";

const MAINTENANCE = new Set(["doctor", "upgrade", "rollback", "uninstall", "install"]);

function storageProbe(
  inferWindowsProfileFromExecutable: () => string | undefined,
  checkDesktopProfile: (mode: "prepare" | "inspect" | "require") => void = () => {},
): NonNullable<PrepareCliProfileDeps["storage"]> {
  return {
    checkDesktopProfile,
    DesktopProfileError,
    getKunaiPaths: () => {
      throw new Error("getKunaiPaths should not be reached");
    },
    inferWindowsProfileFromExecutable,
  };
}

describe("versionRequestSkipsWindowsProfileInference", () => {
  for (const argv of [["--version"], ["-v"], ["-S", "Dune", "--version"]]) {
    test(`skips inference for the global version fast path ${JSON.stringify(argv)}`, () => {
      expect(versionRequestSkipsWindowsProfileInference(argv, MAINTENANCE)).toBe(true);
    });
  }

  for (const argv of [
    ["doctor", "--version"],
    ["upgrade", "--version"],
    ["rollback", "-v"],
    ["plain-launcher-argument"],
    [],
  ]) {
    test(`keeps inference for non-version invocation ${JSON.stringify(argv)}`, () => {
      expect(versionRequestSkipsWindowsProfileInference(argv, MAINTENANCE)).toBe(false);
    });
  }
});

describe("prepareCliProfile Windows inference wiring", () => {
  test("does not invoke inference for the installer --version smoke path", async () => {
    let inferenceCalls = 0;
    const env: NodeJS.ProcessEnv = {};
    const result = await prepareCliProfile(["--version"], MAINTENANCE, true, {
      platform: "win32",
      env,
      storage: storageProbe(() => {
        inferenceCalls += 1;
        return "C:\\profiles\\personal";
      }),
    });

    expect(result).toBe(true);
    expect(inferenceCalls).toBe(0);
    expect(env.KUNAI_CONFIG_DIR).toBeUndefined();
  });

  test("still binds an inferred profile for ordinary launcher invocations", async () => {
    let inferenceCalls = 0;
    const inspected: string[] = [];
    const env: NodeJS.ProcessEnv = {};
    const result = await prepareCliProfile(["plain-launcher-argument"], MAINTENANCE, true, {
      platform: "win32",
      env,
      storage: storageProbe(
        () => {
          inferenceCalls += 1;
          return "C:\\profiles\\personal";
        },
        (mode) => inspected.push(mode),
      ),
    });

    expect(result).toBe(true);
    expect(inferenceCalls).toBe(1);
    expect(env.KUNAI_CONFIG_DIR).toBe("C:\\profiles\\personal");
    expect(inspected).toEqual(["inspect"]);
  });
});
