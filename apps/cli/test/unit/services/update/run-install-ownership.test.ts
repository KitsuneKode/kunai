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

const { runInstall } = await import("@/services/update/run-install");

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
