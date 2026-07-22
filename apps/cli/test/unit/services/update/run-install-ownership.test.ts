import { afterAll, expect, mock, test } from "bun:test";
import { join } from "node:path";

import type { InstallDiagnostic } from "@/services/update/native-installer/install-diagnostic";

const UPDATE_ROOT = join(import.meta.dir, "../../../../src/services/update");
const installLatest = mock(async () => ({ status: "installed" as const, version: "0.3.0" }));
const checkInstall = mock(async () => []);
const getInstallDiagnostics = mock(async (): Promise<InstallDiagnostic[]> => []);

// Capture the real module before mocking so we can put it back afterwards.
// The native-installer index re-exports install-diagnostic; a leaked module
// mock therefore poisons later suites that import the real diagnostic through
// the same registry, and `mock.restore()` does not undo `mock.module`.
const NATIVE_INSTALLER_SPECIFIER = "@/services/update/native-installer";
const realNativeInstaller = { ...(await import(NATIVE_INSTALLER_SPECIFIER)) };

mock.module(NATIVE_INSTALLER_SPECIFIER, () => ({
  ...realNativeInstaller,
  checkInstall,
  getInstallDiagnostics,
  installLatest,
}));

const { buildPackageInstallCommand, inspectPackageInstall, runInstall } =
  await import("@/services/update/run-install");

afterAll(() => {
  mock.module(NATIVE_INSTALLER_SPECIFIER, () => realNativeInstaller);
});

test("native install has no package-manager cleanup side effect", async () => {
  const source = await Bun.file(join(UPDATE_ROOT, "run-install.ts")).text();

  expect(source).not.toContain("cleanupNpmInstallations");
  expect(source).not.toMatch(/\b(?:npm|bun)\b.*\b(?:uninstall|remove)\b/);
});

test("native install emits every diagnostic at its matching severity", async () => {
  getInstallDiagnostics.mockResolvedValueOnce([
    { level: "info", code: "path-winner", message: "info diagnostic" },
    { level: "warn", code: "launcher-shadowed", message: "warn diagnostic" },
    { level: "error", code: "missing-launcher", message: "error diagnostic" },
  ]);

  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = ((message: string) => logs.push(message)) as typeof console.log;
  console.warn = ((message: string) => warnings.push(message)) as typeof console.warn;
  console.error = ((message: string) => errors.push(message)) as typeof console.error;

  try {
    await expect(runInstall(["--skip-deps"])).resolves.toBe(0);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  expect(logs).toContain("info diagnostic");
  expect(warnings).not.toContain("info diagnostic");
  expect(errors).not.toContain("info diagnostic");

  expect(warnings).toContain("warn diagnostic");
  expect(logs).not.toContain("warn diagnostic");
  expect(errors).not.toContain("warn diagnostic");

  expect(errors).toContain("error diagnostic");
  expect(logs).not.toContain("error diagnostic");
  expect(warnings).not.toContain("error diagnostic");
});

test.each([
  ["npm", ["npm", "install", "-g", "@kitsunekode/kunai@4.5.6"]],
  ["bun", ["bun", "install", "-g", "@kitsunekode/kunai@4.5.6"]],
] as const)("builds an immutable explicit %s install argv", (method, expected) => {
  expect(buildPackageInstallCommand(method, "4.5.6")).toEqual(expected);
});

test.each([
  ["npm", ["npm", "install", "-g", "@kitsunekode/kunai"]],
  ["bun", ["bun", "install", "-g", "@kitsunekode/kunai"]],
] as const)("keeps latest %s installs unversioned", (method, expected) => {
  expect(buildPackageInstallCommand(method, "latest")).toEqual(expected);
});

test("records the observed installed version only after a successful package install", async () => {
  const events: string[] = [];
  const manifests: Array<{ activeVersion: string }> = [];

  const code = await runInstall(["--method", "npm"], {
    runCommand: async (command) => {
      events.push(`command:${command.join(" ")}`);
      return 0;
    },
    inspectPackageInstall: async () => {
      events.push("observe:4.5.6");
      return { version: "4.5.6", launcherPath: "/test/bin/kunai" };
    },
    writeInstallManifest: async (manifest) => {
      events.push(`manifest:${manifest.activeVersion}`);
      manifests.push(manifest);
    },
  });

  expect(code).toBe(0);
  expect(events).toEqual([
    "command:npm install -g @kitsunekode/kunai",
    "observe:4.5.6",
    "manifest:4.5.6",
  ]);
  expect(manifests).toEqual([expect.objectContaining({ activeVersion: "4.5.6" })]);
});

test("rejects invalid package versions before commands or manifest writes", async () => {
  const events: string[] = [];
  const code = await runInstall(["--method", "bun", "../4.5.6"], {
    runCommand: async () => {
      events.push("command");
      return 0;
    },
    inspectPackageInstall: async () => {
      events.push("observe");
      return { version: "4.5.6", launcherPath: "/test/bin/kunai" };
    },
    writeInstallManifest: async () => {
      events.push("manifest");
    },
  });

  expect(code).toBe(1);
  expect(events).toEqual([]);
});

test("does not observe or write a manifest after a package-manager failure", async () => {
  const events: string[] = [];
  const code = await runInstall(["--method", "npm", "4.5.6"], {
    runCommand: async (command) => {
      events.push(`command:${command.join(" ")}`);
      return 17;
    },
    inspectPackageInstall: async () => {
      events.push("observe");
      return { version: "4.5.6", launcherPath: "/test/bin/kunai" };
    },
    writeInstallManifest: async () => {
      events.push("manifest");
    },
  });

  expect(code).toBe(17);
  expect(events).toEqual(["command:npm install -g @kitsunekode/kunai@4.5.6"]);
});

test.each([
  ["an unverifiable install", null],
  ["an explicit version mismatch", "4.5.7"],
] as const)("does not write a manifest for %s", async (_label, observedVersion) => {
  const events: string[] = [];
  const code = await runInstall(["--method", "bun", "4.5.6"], {
    runCommand: async () => {
      events.push("command");
      return 0;
    },
    inspectPackageInstall: async () => {
      events.push(`observe:${observedVersion}`);
      return observedVersion ? { version: observedVersion, launcherPath: "/test/bin/kunai" } : null;
    },
    writeInstallManifest: async () => {
      events.push("manifest");
    },
  });

  expect(code).toBe(1);
  expect(events).toEqual(["command", `observe:${observedVersion}`]);
});

test("npm inspection ignores a stale PATH launcher and trusts npm-owned package metadata", async () => {
  const commands: string[] = [];
  const evidence = await inspectPackageInstall("npm", {
    captureCommand: async (command) => {
      commands.push(command.join(" "));
      return command[1] === "root"
        ? { code: 0, stdout: "/npm/root\n" }
        : { code: 0, stdout: "/npm/prefix\n" };
    },
    readText: async (path) => {
      expect(path).toBe("/npm/root/@kitsunekode/kunai/package.json");
      return JSON.stringify({ name: "@kitsunekode/kunai", version: "4.5.6" });
    },
    platform: "linux",
  });

  // A PATH `kunai` reporting 1.0.0 is intentionally never consulted.
  expect(commands).toEqual(["npm root -g", "npm prefix -g"]);
  expect(evidence).toEqual({ version: "4.5.6", launcherPath: "/npm/prefix/bin/kunai" });
});

test("bun inspection reads Bun-owned global package metadata", async () => {
  const evidence = await inspectPackageInstall("bun", {
    bunGlobalDir: () => "/bun/global",
    bunGlobalBinDir: () => "/bun/bin",
    readText: async (path) => {
      expect(path).toBe("/bun/global/node_modules/@kitsunekode/kunai/package.json");
      return JSON.stringify({ name: "@kitsunekode/kunai", version: "4.5.6" });
    },
    platform: "linux",
  });

  expect(evidence).toEqual({ version: "4.5.6", launcherPath: "/bun/bin/kunai" });
});
