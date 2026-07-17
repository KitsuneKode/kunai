import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("root dev script launches the CLI source entrypoint without a nested package script", async () => {
  const rootPackage = (await Bun.file(
    resolve(import.meta.dir, "../../../../../package.json"),
  ).json()) as {
    readonly scripts?: Record<string, string>;
  };

  expect(rootPackage.scripts?.dev).toBe("bun apps/cli/src/main.ts");
});

test("canonical root-content renderer demand-loads the root overlay implementation", async () => {
  const inkShellSource = await Bun.file(
    resolve(import.meta.dir, "../../../src/app-shell/ink-shell.tsx"),
  ).text();
  const rootContentSource = await Bun.file(
    resolve(import.meta.dir, "../../../src/app-shell/root-content-shell.tsx"),
  ).text();
  const rootOverlayLoaderSource = await Bun.file(
    resolve(import.meta.dir, "../../../src/app-shell/RootOverlayLoader.tsx"),
  ).text();

  expect(inkShellSource).not.toContain("root-overlay-shell");
  expect(rootContentSource).not.toMatch(/from ["']\.\/root-overlay-shell["']/);
  expect(rootContentSource).toContain('from "./RootOverlayLoader"');
  expect(rootOverlayLoaderSource).toContain('import("./root-overlay-shell")');
});
