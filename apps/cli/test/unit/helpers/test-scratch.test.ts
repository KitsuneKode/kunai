import { describe, expect, test } from "bun:test";
import { posix, win32 } from "node:path";

import {
  POSIX_SCRATCH_PATH_LIMIT,
  applyTempEnv,
  assertScratchPath,
  cleanupTestScratch,
  createTestScratchDirectory,
  disposeTestScratch,
  hostTempDirectory,
  leftoverMessage,
  testScratchLeftovers,
  scratchKeepsMpvSocket,
  selectScratchParent,
  snapshotTempEnv,
  type ScratchLeakReport,
  type TempEnvSnapshot,
  type TestScratchSession,
} from "../../../../../test/helpers/test-scratch";

const MACOS_TMP = "/var/folders/qb/8nz0spg51dx1z34f56r00000gn/T";
const SOCKET_TAIL = "/kunai-ipc/kunai-mpv-0123456789abcdef.sock";

function recordingIo(names: readonly string[], env: NodeJS.ProcessEnv) {
  const removed: string[] = [];
  const seenAtRemove: TempEnvSnapshot[] = [];
  return {
    removed,
    seenAtRemove,
    io: {
      list: (): readonly string[] => names,
      remove: (directory: string) => {
        seenAtRemove.push(snapshotTempEnv(env));
        removed.push(directory);
      },
    },
  };
}

describe("test scratch guard", () => {
  test("names leftovers relative to the scratch and caps the list at 20", () => {
    const names = Array.from({ length: 21 }, (_, index) => `kunai-left-${index}`);
    const message = leftoverMessage(names);
    expect(message).toContain("kunai-left-0");
    expect(message).toContain("kunai-left-19");
    expect(message).not.toContain("kunai-left-20");
    expect(message).toContain("(+1 more)");
    expect(message).not.toContain("/tmp/");
  });

  test("the preload hook records a CI leak instead of throwing, so later hooks still run", () => {
    // Bun skips every later preload afterAll once one throws; the profile
    // guard is registered after this hook and must not be skipped by a leak.
    const env: NodeJS.ProcessEnv = { CI: "true", TMPDIR: "/scratch/kt-1-abcd" };
    const { io, removed } = recordingIo(["kunai-left"], env);
    let profileCleaned = false;
    const session: TestScratchSession = {
      directory: "/scratch/kt-1-abcd",
      previous: { TMPDIR: "/tmp", TMP: undefined, TEMP: undefined },
      profileCleanup: () => {
        profileCleaned = true;
      },
      failure: undefined,
    };

    expect(() => cleanupTestScratch(session, env, io, () => {})).not.toThrow();
    expect(profileCleaned).toBe(true);
    expect(removed).toEqual(["/scratch/kt-1-abcd"]);
    expect(env.TMPDIR).toBe("/tmp");
    expect(session.failure?.message).toContain("kunai-left");
  });

  test("an empty kunai-ipc socket directory is expected, a socket left inside it is not", () => {
    // macOS has no XDG_RUNTIME_DIR, so mpv sockets live in $TMPDIR/kunai-ipc,
    // a directory production keeps on purpose.
    expect(testScratchLeftovers(["kunai-ipc"], () => [])).toEqual([]);
    // pwsh's .NET runtime cache is not a test leak either.
    expect(testScratchLeftovers([".dotnet", "node-compile-cache"])).toEqual([]);
    expect(testScratchLeftovers(["kunai-ipc", "kunai-x"], () => ["kunai-mpv-0123.sock"])).toEqual([
      "kunai-ipc/kunai-mpv-0123.sock",
      "kunai-x",
    ]);
  });

  test("CI throws after the scratch is removed and the previous temp env is back", () => {
    const env: NodeJS.ProcessEnv = { TMPDIR: "/orig", TEMP: "/temp-orig" };
    const previous = snapshotTempEnv(env);
    applyTempEnv(env, "/scratch/kt-1-ab12");
    const recorded = recordingIo(
      ["kunai-install-latest-aaaaaa", "kunai-mpv-conf-test-bbbbbb"],
      env,
    );
    const warnings: string[] = [];
    const report: ScratchLeakReport = {
      ci: true,
      warn: (line) => {
        warnings.push(line);
      },
    };
    expect(() =>
      disposeTestScratch("/scratch/kt-1-ab12", previous, env, recorded.io, report),
    ).toThrow(/kunai-install-latest-aaaaaa, kunai-mpv-conf-test-bbbbbb/);
    expect(recorded.removed).toEqual(["/scratch/kt-1-ab12"]);
    expect(recorded.seenAtRemove).toEqual([previous]);
    expect(env.TMPDIR).toBe("/orig");
    expect(env.TMP).toBeUndefined();
    expect(env.TEMP).toBe("/temp-orig");
    expect(warnings).toEqual([]);
  });

  test("a local run warns once, still removes the scratch, and restores unset keys", () => {
    const env: NodeJS.ProcessEnv = { TMP: "/only-tmp" };
    const previous = snapshotTempEnv(env);
    applyTempEnv(env, "/scratch/kt-2-cd34");
    const recorded = recordingIo(["kunai-keys-backup-cccccc"], env);
    const warnings: string[] = [];
    disposeTestScratch("/scratch/kt-2-cd34", previous, env, recorded.io, {
      ci: false,
      warn: (line) => {
        warnings.push(line);
      },
    });
    expect(warnings).toEqual([leftoverMessage(["kunai-keys-backup-cccccc"])]);
    expect(recorded.removed).toEqual(["/scratch/kt-2-cd34"]);
    expect(recorded.seenAtRemove[0]?.TMPDIR).toBeUndefined();
    expect(env.TMPDIR).toBeUndefined();
    expect(env.TMP).toBe("/only-tmp");
    expect(env.TEMP).toBeUndefined();
  });

  test("bun's compile cache in the scratch is not reported as a test leak", () => {
    const env: NodeJS.ProcessEnv = { TMPDIR: "/orig" };
    const previous = snapshotTempEnv(env);
    const recorded = recordingIo(["node-compile-cache", "kunai-left"], env);
    const warnings: string[] = [];
    expect(() =>
      disposeTestScratch("/scratch/kt-4-ab12", previous, env, recorded.io, {
        ci: true,
        warn: (line) => {
          warnings.push(line);
        },
      }),
    ).toThrow(/kunai-left/);
    expect(warnings).toEqual([]);

    const onlyCache = recordingIo(["node-compile-cache"], { TMPDIR: "/scratch/kt-4-ab12" });
    const cacheEnv: NodeJS.ProcessEnv = { TMPDIR: "/scratch/kt-4-ab12" };
    const cachePrevious = snapshotTempEnv({ TMPDIR: "/orig" });
    disposeTestScratch("/scratch/kt-4-ab12", cachePrevious, cacheEnv, onlyCache.io, {
      ci: true,
      warn: (line) => {
        warnings.push(line);
      },
    });
    expect(warnings).toEqual([]);
    expect(onlyCache.removed).toEqual(["/scratch/kt-4-ab12"]);
  });

  test("an empty scratch is removed with no warning and no throw", () => {
    const env: NodeJS.ProcessEnv = { TMPDIR: "/orig", TMP: "/orig", TEMP: "/orig" };
    const previous = snapshotTempEnv(env);
    applyTempEnv(env, "/scratch/kt-3-ef56");
    const recorded = recordingIo([], env);
    const warnings: string[] = [];
    disposeTestScratch("/scratch/kt-3-ef56", previous, env, recorded.io, {
      ci: true,
      warn: (line) => {
        warnings.push(line);
      },
    });
    expect(warnings).toEqual([]);
    expect(recorded.removed).toEqual(["/scratch/kt-3-ef56"]);
    expect(env).toEqual({ TMPDIR: "/orig", TMP: "/orig", TEMP: "/orig" });
  });

  test("POSIX scratch paths longer than 64 characters are rejected", () => {
    expect(() => assertScratchPath("x".repeat(POSIX_SCRATCH_PATH_LIMIT), "linux")).not.toThrow();
    expect(() => assertScratchPath("x".repeat(POSIX_SCRATCH_PATH_LIMIT + 1), "linux")).toThrow(
      /64/,
    );
    expect(() => assertScratchPath("x".repeat(POSIX_SCRATCH_PATH_LIMIT), "darwin")).not.toThrow();
    expect(() => assertScratchPath("D:\\" + "x".repeat(200), "win32")).not.toThrow();
  });

  test("a deep macOS temp directory cannot host the scratch without breaking the mpv socket", () => {
    const name = "kt-12345-ab12";
    const nested = posix.join(MACOS_TMP, name);
    expect(nested.length).toBeLessThanOrEqual(POSIX_SCRATCH_PATH_LIMIT);
    expect(scratchKeepsMpvSocket(nested)).toBe(false);
    expect(Buffer.byteLength(`${nested}${SOCKET_TAIL}`)).toBeGreaterThanOrEqual(100);
    expect(selectScratchParent("darwin", name, [MACOS_TMP, "/tmp"])).toBe("/tmp");
    const scratch = posix.join("/tmp", name);
    expect(scratch.length).toBeLessThanOrEqual(POSIX_SCRATCH_PATH_LIMIT);
    expect(scratchKeepsMpvSocket(scratch)).toBe(true);
  });

  test("linux keeps the real temp directory when the socket path still fits", () => {
    expect(selectScratchParent("linux", "kt-12345-ab12", ["/var/tmp", "/tmp"])).toBe("/var/tmp");
  });

  test("windows reads TEMP before TMP and still sets TMPDIR, TMP, and TEMP", () => {
    const longTemp = `C:\\${"x".repeat(80)}`;
    const env: NodeJS.ProcessEnv = { TEMP: longTemp, TMP: "D:\\Alt" };
    expect(hostTempDirectory("win32", env)).toBe(longTemp);
    expect(hostTempDirectory("win32", { TMP: "D:\\Alt" })).toBe("D:\\Alt");
    const created: string[] = [];
    const directory = createTestScratchDirectory("win32", env, 42, ["ab12"], (path) => {
      created.push(path);
    });
    expect(directory).toBe(win32.join(longTemp, "kt-42-ab12"));
    expect(created).toEqual([directory]);
    expect(directory.length).toBeGreaterThan(POSIX_SCRATCH_PATH_LIMIT);
    applyTempEnv(env, directory);
    expect(env.TEMP).toBe(directory);
    expect(env.TMP).toBe(directory);
    expect(env.TMPDIR).toBe(directory);
  });

  test("a taken scratch name tries the next suffix", () => {
    const taken = new Set(["/tmp/kt-7-aaaa"]);
    const directory = createTestScratchDirectory(
      "linux",
      { TMPDIR: "/tmp" },
      7,
      ["aaaa", "bbbb"],
      (path) => {
        if (taken.has(path)) {
          const error = new Error("exists");
          Object.assign(error, { code: "EEXIST" });
          throw error;
        }
      },
    );
    expect(directory).toBe("/tmp/kt-7-bbbb");
  });
});
