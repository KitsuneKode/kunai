import { describe, expect, test } from "bun:test";
import { dirname } from "node:path";

import {
  openExternal,
  type ExternalOpenRuntime,
  type ExternalOpenTarget,
} from "@/infra/os/external-open";

function runtime(
  overrides: Partial<ExternalOpenRuntime> & Pick<ExternalOpenRuntime, "platform">,
): ExternalOpenRuntime {
  return {
    which: () => null,
    spawn: () => {
      throw new Error("spawn not stubbed");
    },
    isDisabled: () => false,
    ...overrides,
  };
}

function succeedingSpawn(commandCapture: string[][]): ExternalOpenRuntime["spawn"] {
  return (command) => {
    commandCapture.push([...command]);
    return { exited: Promise.resolve(0) };
  };
}

describe("external-open", () => {
  test("Linux uses only xdg-open for URLs", async () => {
    const commands: string[][] = [];
    const LINUX_RUNTIME = runtime({
      platform: "linux",
      which: (cmd) => (cmd === "xdg-open" ? "/usr/bin/xdg-open" : null),
      spawn: succeedingSpawn(commands),
    });

    const result = await openExternal({ kind: "url", url: "https://example.com" }, LINUX_RUNTIME);
    expect(result).toMatchObject({
      ok: true,
      command: ["/usr/bin/xdg-open", "https://example.com"],
      target: { kind: "url", url: "https://example.com" },
    });
    expect(commands).toEqual([["/usr/bin/xdg-open", "https://example.com"]]);
  });

  test("Linux opens the parent directory for path reveal", async () => {
    const path = "/home/user/Videos/Kunai/show.mkv";
    const LINUX_RUNTIME = runtime({
      platform: "linux",
      which: (cmd) => (cmd === "xdg-open" ? "/usr/bin/xdg-open" : null),
      spawn: succeedingSpawn([]),
    });

    const result = await openExternal({ kind: "path", path }, LINUX_RUNTIME);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.command).toEqual(["/usr/bin/xdg-open", dirname(path)]);
  });

  test("macOS uses open for URLs and open -R for paths", async () => {
    const DARWIN_URL = runtime({
      platform: "darwin",
      which: (cmd) => (cmd === "open" ? "/usr/bin/open" : null),
      spawn: succeedingSpawn([]),
    });
    const urlResult = await openExternal({ kind: "url", url: "https://example.com" }, DARWIN_URL);
    expect(urlResult).toMatchObject({
      ok: true,
      command: ["/usr/bin/open", "https://example.com"],
    });

    const path = "/Users/me/Movies/show.mkv";
    const DARWIN_PATH = runtime({
      platform: "darwin",
      which: (cmd) => (cmd === "open" ? "/usr/bin/open" : null),
      spawn: succeedingSpawn([]),
    });
    const pathResult = await openExternal({ kind: "path", path }, DARWIN_PATH);
    expect(pathResult).toMatchObject({
      ok: true,
      command: ["/usr/bin/open", "-R", path],
    });
  });

  test("Windows uses cmd start for URLs and explorer /select for paths", async () => {
    const WIN_URL = runtime({
      platform: "win32",
      which: (cmd) =>
        cmd === "cmd.exe" || cmd === "cmd" ? "C:\\Windows\\System32\\cmd.exe" : null,
      spawn: succeedingSpawn([]),
    });
    const urlResult = await openExternal({ kind: "url", url: "https://example.com" }, WIN_URL);
    expect(urlResult).toMatchObject({
      ok: true,
      command: ["C:\\Windows\\System32\\cmd.exe", "/c", "start", "", "https://example.com"],
    });

    const path = "C:\\Users\\me\\Videos\\show.mkv";
    const WIN_PATH = runtime({
      platform: "win32",
      which: (cmd) =>
        cmd === "explorer.exe" || cmd === "explorer" ? "C:\\Windows\\explorer.exe" : null,
      spawn: succeedingSpawn([]),
    });
    const pathResult = await openExternal({ kind: "path", path }, WIN_PATH);
    expect(pathResult).toMatchObject({
      ok: true,
      command: ["C:\\Windows\\explorer.exe", `/select,${path}`],
    });
  });

  test("spawn exception becomes typed failure", async () => {
    const THROWING_RUNTIME = runtime({
      platform: "linux",
      which: (cmd) => (cmd === "xdg-open" ? "/usr/bin/xdg-open" : null),
      spawn: () => {
        throw new Error("ENOENT");
      },
    });

    expect(
      await openExternal({ kind: "url", url: "https://example.com" }, THROWING_RUNTIME),
    ).toMatchObject({
      ok: false,
      reason: "spawn-failed",
      target: { kind: "url", url: "https://example.com" },
    });
  });

  test("rejected exited promise becomes spawn-failed", async () => {
    const REJECTING_RUNTIME = runtime({
      platform: "linux",
      which: (cmd) => (cmd === "xdg-open" ? "/usr/bin/xdg-open" : null),
      spawn: () => ({ exited: Promise.reject(new Error("broken pipe")) }),
    });

    expect(
      await openExternal({ kind: "url", url: "https://example.com" }, REJECTING_RUNTIME),
    ).toMatchObject({
      ok: false,
      reason: "spawn-failed",
    });
  });

  test("non-zero exit becomes typed failure", async () => {
    const FAIL_RUNTIME = runtime({
      platform: "linux",
      which: (cmd) => (cmd === "xdg-open" ? "/usr/bin/xdg-open" : null),
      spawn: () => ({ exited: Promise.resolve(1) }),
    });

    expect(
      await openExternal({ kind: "url", url: "https://example.com" }, FAIL_RUNTIME),
    ).toMatchObject({
      ok: false,
      reason: "non-zero-exit",
      detail: "exit 1",
    });
  });

  test("missing opener becomes opener-not-found", async () => {
    const MISSING = runtime({
      platform: "linux",
      which: () => null,
      spawn: succeedingSpawn([]),
    });

    expect(await openExternal({ kind: "url", url: "https://example.com" }, MISSING)).toMatchObject({
      ok: false,
      reason: "opener-not-found",
    });
  });

  test("disabled runtime returns disabled without spawning", async () => {
    let spawned = false;
    const DISABLED = runtime({
      platform: "linux",
      which: () => "/usr/bin/xdg-open",
      isDisabled: () => true,
      spawn: () => {
        spawned = true;
        return { exited: Promise.resolve(0) };
      },
    });

    const target: ExternalOpenTarget = { kind: "url", url: "https://example.com" };
    expect(await openExternal(target, DISABLED)).toMatchObject({
      ok: false,
      reason: "disabled",
      target,
    });
    expect(spawned).toBe(false);
  });

  test("unsupported platform returns typed failure", async () => {
    const OTHER = runtime({
      platform: "freebsd" as NodeJS.Platform,
      which: () => "/bin/open",
      spawn: succeedingSpawn([]),
    });

    expect(await openExternal({ kind: "url", url: "https://example.com" }, OTHER)).toMatchObject({
      ok: false,
      reason: "unsupported-platform",
    });
  });
});
