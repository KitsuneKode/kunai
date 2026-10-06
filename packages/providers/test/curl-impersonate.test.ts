import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __testing, resolveCurlCandidate } from "../src/shared/curl-impersonate";

/** A PATH dir with nothing but a fake curl_ff wrapper. */
function makeWrapperDir(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "curl-shim-test-"));
  writeFileSync(join(dir, `curl_ff${version}`), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return dir;
}

describe("resolveCurlCandidate PATH scan", () => {
  const savedPath = process.env.PATH;
  const dirs: string[] = [];

  afterEach(() => {
    process.env.PATH = savedPath;
    __testing.resetPathCache();
    while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  test("sees a curl_* wrapper added after a first resolve — no stale PATH cache", () => {
    // First scan under a PATH with no curl_* wrappers at all.
    const barren = mkdtempSync(join(tmpdir(), "curl-barren-"));
    dirs.push(barren);
    process.env.PATH = barren;
    expect(resolveCurlCandidate()?.impersonates ?? false).toBe(false);

    // Prepend a wrapper dir WITHOUT resetting the cache — the PATH-keyed
    // refresh must notice the change on its own.
    const shim = makeWrapperDir("99");
    dirs.push(shim);
    process.env.PATH = `${shim}:${barren}`;
    const candidate = resolveCurlCandidate();
    expect(candidate?.impersonates).toBe(true);
    expect(candidate?.profile).toBe("ff99");
    expect(candidate?.path).toBe(join(shim, "curl_ff99"));
    expect(candidate?.prefixArgs).toEqual([]);
  });

  test("drops a wrapper that left PATH on the next resolve", () => {
    const shim = makeWrapperDir("88");
    dirs.push(shim);
    process.env.PATH = shim;
    expect(resolveCurlCandidate()?.profile).toBe("ff88");

    const empty = mkdtempSync(join(tmpdir(), "curl-empty-"));
    dirs.push(empty);
    process.env.PATH = empty;
    // A stale cache would keep returning the old wrapper name/path.
    const candidate = resolveCurlCandidate();
    expect(candidate?.path ?? "").not.toContain("curl_ff88");
  });

  test("on Windows, managed .bat wrappers execute curl-impersonate.exe directly", () => {
    const root = mkdtempSync(join(tmpdir(), "curl-win-managed-"));
    dirs.push(root);
    const wrapper = join(root, "curl_chrome150.bat");
    const backend = join(root, "curl-impersonate.exe");
    writeFileSync(wrapper, "@echo off\r\n");
    writeFileSync(backend, "MZ");

    const candidate = resolveCurlCandidate({
      platform: "win32",
      listPathEntries: () => ["curl_chrome150.bat"],
      which: (command) => (command === "curl_chrome150.bat" ? wrapper : null),
      fileExists: (path) => path === backend,
    });

    expect(candidate).toEqual({
      path: backend,
      prefixArgs: ["--compressed", "--impersonate", "chrome150"],
      impersonates: true,
      profile: "chrome150",
    });
  });

  test("on Windows, wrapper execution remains as fallback when backend is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "curl-win-fallback-"));
    dirs.push(root);
    const wrapper = join(root, "curl_firefox147.cmd");
    writeFileSync(wrapper, "@echo off\r\n");

    const candidate = resolveCurlCandidate({
      platform: "win32",
      listPathEntries: () => ["curl_firefox147.cmd"],
      which: (command) => (command === "curl_firefox147.cmd" ? wrapper : null),
      fileExists: () => false,
    });

    expect(candidate).toEqual({
      path: wrapper,
      prefixArgs: [],
      impersonates: true,
      profile: "firefox147",
    });
  });
});
