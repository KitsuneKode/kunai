import { describe, expect, test } from "bun:test";

import { createMpvIpcEndpoint, mpvIpcSocketDirCandidates } from "@/infra/player/mpv-ipc-endpoint";

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
  test("prefers XDG_RUNTIME_DIR, then a private temp subdir, then bare temp", () => {
    expect(
      mpvIpcSocketDirCandidates({ XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" }),
    ).toEqual(["/run/user/1000/kunai", "/tmp/kunai-ipc", "/tmp"]);
  });

  test("macOS has no XDG_RUNTIME_DIR, so the private temp subdir leads", () => {
    // Not hypothetical: macOS does not set XDG_RUNTIME_DIR at all. Assuming it
    // exists is how a Linux-shaped fix regresses every Mac.
    expect(mpvIpcSocketDirCandidates({ TMPDIR: "/var/folders/ab/xyz/T/" })).toEqual([
      "/var/folders/ab/xyz/T/kunai-ipc",
      "/var/folders/ab/xyz/T/",
    ]);
  });

  test("an empty XDG_RUNTIME_DIR is ignored rather than producing a bare path", () => {
    expect(mpvIpcSocketDirCandidates({ XDG_RUNTIME_DIR: "   ", TMPDIR: "/tmp" })).toEqual([
      "/tmp/kunai-ipc",
      "/tmp",
    ]);
  });

  test("creates the chosen directory owner-only and puts the socket in it", () => {
    const made: Array<string> = [];
    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      makeDir: (path) => made.push(path),
    });

    expect(made).toEqual(["/run/user/1000/kunai"]);
    expect(endpoint).toEqual({
      kind: "unix_socket",
      path: "/run/user/1000/kunai/kunai-mpv-abc-123.sock",
    });
  });

  test("falls through when the runtime dir cannot be created", () => {
    const made: Array<string> = [];
    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      makeDir: (path) => {
        made.push(path);
        if (path.startsWith("/run/user")) throw new Error("EACCES");
      },
    });

    expect(made).toEqual(["/run/user/1000/kunai", "/tmp/kunai-ipc"]);
    expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc-123.sock");
  });

  test("falls back to bare temp when every private directory fails", () => {
    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp" },
      makeDir: () => {
        throw new Error("EROFS");
      },
    });
    // The previous behaviour, so a locked-down box still plays.
    expect(endpoint.path).toBe("/tmp/kunai-mpv-abc-123.sock");
  });

  /**
   * `sun_path` is 108 bytes on Linux and 104 on macOS. A long XDG_RUNTIME_DIR
   * plus a session id genuinely reaches that, and bind fails outright — so an
   * over-long candidate must be skipped, not returned.
   */
  test("skips candidates that would exceed the sun_path limit", () => {
    const long = `/run/user/1000/${"d".repeat(90)}`;
    const endpoint = createMpvIpcEndpoint("abc-123", "linux", {
      env: { XDG_RUNTIME_DIR: long, TMPDIR: "/tmp" },
      makeDir: () => {},
    });

    expect(endpoint.path.startsWith(long)).toBe(false);
    expect(Buffer.byteLength(endpoint.path, "utf8")).toBeLessThan(100);
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
      makeDir: () => {},
    });
    expect(endpoint.path).not.toContain("\\");
    expect(endpoint.path.startsWith("/")).toBe(true);
  });

  test("Windows is untouched — named pipes, and the backslash spelling mpv needs", () => {
    const endpoint = createMpvIpcEndpoint("abc-123", "win32", {
      env: { TMPDIR: "C:\\Temp" },
      makeDir: () => {
        throw new Error("must not be called on win32");
      },
    });

    expect(endpoint.kind).toBe("windows_pipe");
    expect(endpoint.path).toBe("\\\\.\\pipe\\kunai-mpv-abc123");
  });
});
