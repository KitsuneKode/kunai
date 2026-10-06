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
    const wrapper = "C:\\tools\\curl_chrome150.bat";
    const backend = "C:\\tools\\curl-impersonate.exe";

    const candidate = resolveCurlCandidate({
      platform: "win32",
      listPathEntries: () => ["curl_chrome150.bat"],
      which: (command) => (command === "curl_chrome150.bat" ? wrapper : null),
      fileExists: (path) => path === backend,
      readTextFile: () => '"%~dp0curl-impersonate.exe" --compressed --impersonate "chrome150" %*',
    });

    expect(candidate).toEqual({
      path: backend,
      prefixArgs: ["--compressed", "--impersonate", "chrome150"],
      impersonates: true,
      profile: "chrome150",
    });
  });

  test("on Windows, a backend-less wrapper falls through to plain curl", () => {
    const wrapper = "C:\\tools\\curl_firefox147.cmd";

    // A .cmd wrapper whose sibling curl-impersonate.exe is gone cannot be
    // spawned at all — returning it would claim impersonation over a guaranteed
    // BatBadBut throw. Plain curl is the honest answer.
    const candidate = resolveCurlCandidate({
      platform: "win32",
      listPathEntries: () => ["curl_firefox147.cmd", "curl"],
      which: (command) =>
        command === "curl_firefox147.cmd"
          ? wrapper
          : command === "curl"
            ? "C:\\Windows\\System32\\curl.exe"
            : null,
      fileExists: () => false,
      readTextFile: () => '"%~dp0curl-impersonate.exe" --compressed --impersonate "ff147" %*',
    });

    expect(candidate).toEqual({
      path: "C:\\Windows\\System32\\curl.exe",
      prefixArgs: [],
      impersonates: false,
      profile: null,
    });
  });

  test("on Windows, a legacy inline-flag wrapper is skipped for a modern one", () => {
    // safari170-era wrappers embed the full handshake as explicit flags —
    // `curl-impersonate.exe --impersonate safari170` is not a real target and
    // would die on an unrecognized-target error. A modern wrapper further down
    // the ranking still wins.
    const safariWrapper = "C:\\tools\\curl_safari170.bat";
    const ffWrapper = "C:\\tools\\curl_firefox147.bat";
    const backend = "C:\\tools\\curl-impersonate.exe";

    const candidate = resolveCurlCandidate({
      platform: "win32",
      listPathEntries: () => ["curl_safari170.bat", "curl_firefox147.bat"],
      which: (command) =>
        command === "curl_safari170.bat"
          ? safariWrapper
          : command === "curl_firefox147.bat"
            ? ffWrapper
            : null,
      fileExists: (path) => path === backend,
      readTextFile: (path) =>
        path === ffWrapper
          ? '"%~dp0curl-impersonate.exe" --compressed --impersonate "ff147" %*'
          : '"%~dp0curl-impersonate.exe" --tlsv1.2 --ciphers "AES128-SHA" --http2 %*',
    });

    expect(candidate).toEqual({
      path: backend,
      prefixArgs: ["--compressed", "--impersonate", "ff147"],
      impersonates: true,
      profile: "ff147",
    });
  });

  test("on POSIX, a .bat surfaced through WSL interop PATH is not executable curl", () => {
    // execve cannot run batch text — reporting it as an impersonating build
    // would claim Cloudflare bypass over a guaranteed ENOEXEC.
    const candidate = resolveCurlCandidate({
      platform: "linux",
      listPathEntries: () => ["curl_chrome150.bat", "curl"],
      which: (command) =>
        command === "curl_chrome150.bat"
          ? "/mnt/c/tools/curl_chrome150.bat"
          : command === "curl"
            ? "/usr/bin/curl"
            : null,
    });

    expect(candidate).toEqual({
      path: "/usr/bin/curl",
      prefixArgs: [],
      impersonates: false,
      profile: null,
    });
  });

  test("on Windows, a host with only legacy wrappers falls back to plain curl", () => {
    const candidate = resolveCurlCandidate({
      platform: "win32",
      listPathEntries: () => ["curl_edge101.bat", "curl"],
      which: (command) =>
        command === "curl_edge101.bat"
          ? "C:\\tools\\curl_edge101.bat"
          : command === "curl"
            ? "C:\\Windows\\System32\\curl.exe"
            : null,
      fileExists: () => true,
      readTextFile: () => '"%~dp0curl-impersonate.exe" --tlsv1.3 --ciphers "AES256-SHA" %*',
    });

    expect(candidate).toEqual({
      path: "C:\\Windows\\System32\\curl.exe",
      prefixArgs: [],
      impersonates: false,
      profile: null,
    });
  });
});
