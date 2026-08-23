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

  test("Windows passes a metacharacter-rich URL as one opaque explorer argument", async () => {
    const url = "https://example.com/watch?title=one&next=two#frag%20three";
    const WIN_URL = runtime({
      platform: "win32",
      which: (cmd) =>
        cmd === "explorer.exe" || cmd === "explorer" ? "C:\\Windows\\explorer.exe" : null,
      spawn: succeedingSpawn([]),
    });
    const urlResult = await openExternal({ kind: "url", url }, WIN_URL);
    expect(urlResult).toMatchObject({
      ok: true,
      command: ["C:\\Windows\\explorer.exe", url],
    });
  });

  test("Windows uses explorer /select for paths", async () => {
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

/**
 * The URLs reaching `openExternal` are not all ours: title metadata carries
 * AniList, IMDb and trailer links that came from external APIs
 * (`root-overlay-shell.tsx`, `SearchPhase.ts`).
 *
 * There is no shell injection here — `Bun.spawn` takes an argv array, not a
 * command string — which is worth pinning so it is not re-raised as one. What
 * did apply: a value starting with `-` is read by the opener as a flag, and
 * every scheme was forwarded, `file://` included.
 */
describe("external-open URL validation", () => {
  const spawnMustNotRun: ExternalOpenRuntime["spawn"] = () => {
    throw new Error("the opener must not be spawned for a rejected URL");
  };

  const rejecting = (platform: NodeJS.Platform) =>
    runtime({
      platform,
      which: () => "/usr/bin/xdg-open",
      spawn: spawnMustNotRun,
    });

  test("refuses option-prefixed values before reaching the opener", async () => {
    for (const url of ["--version", "-e", "--bogus=1"]) {
      const result = await openExternal({ kind: "url", url }, rejecting("linux"));
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("rejected-url");
    }
  });

  test("refuses schemes Kunai never means to open", async () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "smb://server/share",
      "not a url at all",
    ]) {
      const result = await openExternal({ kind: "url", url }, rejecting("linux"));
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("rejected-url");
    }
  });

  test("still opens the schemes it is for", async () => {
    const commands: string[][] = [];
    const allow = runtime({
      platform: "linux",
      which: () => "/usr/bin/xdg-open",
      spawn: succeedingSpawn(commands),
    });

    for (const url of [
      "https://anilist.co/anime/1",
      "http://example.test/x",
      "kunai://play?cat=tmdb%3A438631&kind=movie",
    ]) {
      const result = await openExternal({ kind: "url", url }, allow);
      expect(result.ok).toBe(true);
    }
    expect(commands).toHaveLength(3);
  });

  test("the rule is identical on macOS and Windows", async () => {
    for (const platform of ["darwin", "win32"] as const) {
      const result = await openExternal(
        { kind: "url", url: "file:///etc/passwd" },
        rejecting(platform),
      );
      expect(result.ok === false && result.reason).toBe("rejected-url");
    }
  });

  test("revealing a path is unaffected", async () => {
    const commands: string[][] = [];
    const result = await openExternal(
      { kind: "path", path: "/home/u/Videos/ep.mkv" },
      runtime({
        platform: "linux",
        which: () => "/usr/bin/xdg-open",
        spawn: succeedingSpawn(commands),
      }),
    );
    expect(result.ok).toBe(true);
    expect(commands[0]).toEqual(["/usr/bin/xdg-open", dirname("/home/u/Videos/ep.mkv")]);
  });
});
