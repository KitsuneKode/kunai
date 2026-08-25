import { describe, expect, test } from "bun:test";

import { createMpvIpcEndpoint, mpvIpcSocketDirCandidates } from "@/infra/player/mpv-ipc-endpoint";

type DirectoryFacts = {
  readonly directory: boolean;
  readonly symbolicLink: boolean;
  readonly mode: number;
  readonly uid?: number;
  readonly device: number;
  readonly inode: number;
};

const SAFE_DIRECTORY: DirectoryFacts = {
  directory: true,
  symbolicLink: false,
  mode: 0o700,
  uid: 1000,
  device: 1,
  inode: 2,
};

function directoryOperations(
  factsFor: (path: string, kind: "lstat" | "stat") => DirectoryFacts = () => SAFE_DIRECTORY,
) {
  const made: Array<{ path: string; mode: number }> = [];
  return {
    made,
    operations: {
      makeDirectory(path: string, mode: number) {
        made.push({ path, mode });
      },
      lstat(path: string) {
        return factsFor(path, "lstat");
      },
      stat(path: string) {
        return factsFor(path, "stat");
      },
      currentUid() {
        return 1000;
      },
    },
  };
}

/**
 * The socket used to sit directly in the shared temp dir.
 *
 * To be precise about why that is worth changing, since the usual reasoning is
 * wrong: connect permission on a Unix domain socket comes from the socket
 * inode's own mode, not the directory's, and mpv creates it under the invoking
 * umask — under `umask 022` another local user cannot connect, and `/tmp` is
 * sticky so they cannot replace it either.
 *
 * The real window is `umask 002` (user-private-group distros), where the socket
 * is group-writable and mpv's JSON IPC exposes `run`. Narrow, but a 0700
 * directory closes it for free.
 */
describe("mpv IPC socket directory", () => {
  test("prefers XDG_RUNTIME_DIR, then a private temp subdir, never bare temp", () => {
    expect(
      mpvIpcSocketDirCandidates({ XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" }),
    ).toEqual(["/run/user/1000/kunai", "/tmp/kunai-ipc"]);
  });

  test("macOS has no XDG_RUNTIME_DIR, so the private temp subdir leads", () => {
    // Not hypothetical: macOS does not set XDG_RUNTIME_DIR at all. Assuming it
    // exists is how a Linux-shaped fix regresses every Mac.
    expect(mpvIpcSocketDirCandidates({ TMPDIR: "/var/folders/ab/xyz/T/" })).toEqual([
      "/var/folders/ab/xyz/T/kunai-ipc",
    ]);

    const fake = directoryOperations();
    const endpoint = createMpvIpcEndpoint("abc-123", "darwin", {
      env: { TMPDIR: "/var/folders/ab/xyz/T/" },
      directoryOperations: fake.operations,
    });
    expect(fake.made).toEqual([{ path: "/var/folders/ab/xyz/T/kunai-ipc", mode: 0o700 }]);
    expect(endpoint.path).toBe("/var/folders/ab/xyz/T/kunai-ipc/kunai-mpv-abc-123.sock");
  });

  test("an empty XDG_RUNTIME_DIR is ignored rather than producing a bare path", () => {
    expect(mpvIpcSocketDirCandidates({ XDG_RUNTIME_DIR: "   ", TMPDIR: "/tmp" })).toEqual([
      "/tmp/kunai-ipc",
    ]);
  });

  test("creates the chosen directory owner-only and puts the socket in it", () => {
    const fake = directoryOperations();
    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      directoryOperations: fake.operations,
    });

    expect(fake.made).toEqual([{ path: "/run/user/1000/kunai", mode: 0o700 }]);
    expect(endpoint).toEqual({
      kind: "unix_socket",
      path: "/run/user/1000/kunai/kunai-mpv-abc-123.sock",
    });
  });

  test("falls through when the runtime dir cannot be created", () => {
    const fake = directoryOperations();
    const makeDirectory = fake.operations.makeDirectory;
    fake.operations.makeDirectory = (path, mode) => {
      makeDirectory(path, mode);
      if (path.startsWith("/run/user")) throw new Error("EACCES");
    };
    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      directoryOperations: fake.operations,
    });

    expect(fake.made).toEqual([
      { path: "/run/user/1000/kunai", mode: 0o700 },
      { path: "/tmp/kunai-ipc", mode: 0o700 },
    ]);
    expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc-123.sock");
  });

  test("rejects an existing symlink and falls through to a verified private directory", () => {
    const fake = directoryOperations((path, kind) =>
      path.startsWith("/run/user") && kind === "lstat"
        ? { ...SAFE_DIRECTORY, directory: false, symbolicLink: true }
        : SAFE_DIRECTORY,
    );

    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      directoryOperations: fake.operations,
    });

    expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc-123.sock");
  });

  test("rejects a regular file where the private directory must be", () => {
    const fake = directoryOperations((path, kind) =>
      path.startsWith("/run/user") && kind === "lstat"
        ? { ...SAFE_DIRECTORY, directory: false, symbolicLink: false }
        : SAFE_DIRECTORY,
    );

    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      directoryOperations: fake.operations,
    });

    expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc-123.sock");
  });

  test("rejects a directory replaced between lstat and stat", () => {
    for (const replacement of [{ device: 2 }, { inode: 3 }]) {
      const fake = directoryOperations((path, kind) =>
        path.startsWith("/run/user") && kind === "stat"
          ? { ...SAFE_DIRECTORY, ...replacement }
          : SAFE_DIRECTORY,
      );

      const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
        env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
        directoryOperations: fake.operations,
      });

      expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc-123.sock");
    }
  });

  test("rejects a directory owned by another user", () => {
    const fake = directoryOperations((path) =>
      path.startsWith("/run/user") ? { ...SAFE_DIRECTORY, uid: 2000 } : SAFE_DIRECTORY,
    );

    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      directoryOperations: fake.operations,
    });

    expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc-123.sock");
  });

  test("rejects a group- or world-accessible directory", () => {
    for (const mode of [0o710, 0o701]) {
      const fake = directoryOperations((path) =>
        path.startsWith("/run/user") ? { ...SAFE_DIRECTORY, mode } : SAFE_DIRECTORY,
      );

      const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
        env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
        directoryOperations: fake.operations,
      });

      expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc-123.sock");
    }
  });

  test("fails closed when every private directory cannot be created", () => {
    const fake = directoryOperations();
    fake.operations.makeDirectory = () => {
      throw new Error("EROFS");
    };
    expect(() =>
      createMpvIpcEndpoint("abc-123", "linux", {
        env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
        directoryOperations: fake.operations,
      }),
    ).toThrow("Unable to prepare a private mpv IPC directory");
  });

  /**
   * `sun_path` is 108 bytes on Linux and 104 on macOS. A long XDG_RUNTIME_DIR
   * plus a session id genuinely reaches that, and bind fails outright — so an
   * over-long candidate must be skipped, not returned.
   */
  test("skips candidates that would exceed the sun_path limit", () => {
    const long = `/run/user/1000/${"d".repeat(90)}`;
    const fake = directoryOperations();
    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: long, TMPDIR: "/tmp" },
      directoryOperations: fake.operations,
    });

    expect(endpoint.path.startsWith(long)).toBe(false);
    expect(Buffer.byteLength(endpoint.path, "utf8")).toBeLessThan(100);
  });

  test("fails closed when every private candidate exceeds the sun_path limit", () => {
    const tooLong = `/private/${"d".repeat(110)}`;
    const fake = directoryOperations();
    let filesystemCalls = 0;
    fake.operations.makeDirectory = () => {
      filesystemCalls++;
      throw new Error("overlong candidates must not touch the filesystem");
    };

    expect(() =>
      createMpvIpcEndpoint("abc-123", "darwin", {
        env: { TMPDIR: tooLong },
        directoryOperations: fake.operations,
      }),
    ).toThrow("Unable to prepare a private mpv IPC directory");
    expect(filesystemCalls).toBe(0);
  });

  /**
   * A Unix domain socket path is POSIX by definition, but `path.join` follows
   * the *host* platform — on a Windows runner it emits backslashes. Production
   * never reaches this branch on win32 (named pipes return earlier), so the
   * only place it surfaced was CI, where these tests ran on Windows and every
   * expected path came back separator-flipped.
   *
   * Asserting the shape here catches it on any host, rather than waiting for
   * the Windows job to notice.
   */
  test("socket paths are POSIX-shaped regardless of the host platform", () => {
    const candidates = mpvIpcSocketDirCandidates({
      XDG_RUNTIME_DIR: "/run/user/1000",
      TMPDIR: "/tmp",
    });
    for (const dir of candidates) {
      expect(dir).not.toContain("\\");
    }

    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      directoryOperations: directoryOperations().operations,
    });
    expect(endpoint.path).not.toContain("\\");
    expect(endpoint.path.startsWith("/")).toBe(true);
  });

  test("Windows is untouched — named pipes, and the backslash spelling mpv needs", () => {
    const endpoint = createMpvIpcEndpoint("abc-123", "win32", {
      env: { TMPDIR: "C:\\Temp" },
      directoryOperations: {
        makeDirectory() {
          throw new Error("must not make directories on win32");
        },
        lstat() {
          throw new Error("must not lstat on win32");
        },
        stat() {
          throw new Error("must not stat on win32");
        },
        currentUid() {
          throw new Error("must not read uid on win32");
        },
      },
    });

    expect(endpoint.kind).toBe("windows_pipe");
    expect(endpoint.path).toBe("\\\\.\\pipe\\kunai-mpv-abc123");
  });
});
