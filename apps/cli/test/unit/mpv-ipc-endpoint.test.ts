import { expect, test } from "bun:test";

import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  mpvIpcTransportTag,
  shouldUnlinkUnixSocket,
} from "@/infra/player/mpv-ipc-endpoint";

const BACKSLASH = String.fromCharCode(92);
const WIN_PIPE_PREFIX = `${BACKSLASH}${BACKSLASH}.${BACKSLASH}pipe${BACKSLASH}`;

// The platform is a parameter so the Windows contract is verified from Linux CI
// too. It used to be read from `process.platform` alone, which made this the
// only assertion that could not run on the blocking CI leg — so the endpoint
// shipped in a spelling mpv rejects and nothing failed.
test("builds an mpv-compatible Windows named-pipe endpoint", () => {
  const endpoint = createMpvIpcEndpoint("session:with / unsafe\\characters", "win32");

  expect(endpoint).toEqual({
    kind: "windows_pipe",
    path: `${WIN_PIPE_PREFIX}kunai-mpv-sessionwithunsafecharacters`,
  });
  expect(ipcServerCliArg(endpoint)).toBe(endpoint.path);
  expect(mpvIpcTransportTag(endpoint)).toBe("pipe");
  expect(shouldUnlinkUnixSocket(endpoint)).toBe(false);
});

// mpv parses `--input-ipc-server` itself and only recognises the Win32 spelling.
// Given forward slashes it starts, logs nothing, and never creates the pipe, so
// every connect attempt fails and the player looks dead to the session.
test("Windows pipe path uses backslashes, never the forward-slash spelling", () => {
  const path = createMpvIpcEndpoint("abc123", "win32").path;

  expect(path.startsWith(WIN_PIPE_PREFIX)).toBe(true);
  expect(path).not.toContain("/");
});

test("builds a unix socket endpoint with simulated POSIX filesystem facts off Windows", () => {
  const endpoint = createMpvIpcEndpoint("abc123", "linux", {
    env: { TMPDIR: "/tmp" },
    directoryOperations: {
      makeDirectory() {},
      lstat() {
        return {
          directory: true,
          symbolicLink: false,
          mode: 0o700,
          uid: 1000,
          device: 1,
          inode: 2,
        };
      },
      stat() {
        return {
          directory: true,
          symbolicLink: false,
          mode: 0o700,
          uid: 1000,
          device: 1,
          inode: 2,
        };
      },
      currentUid() {
        return 1000;
      },
    },
  });

  expect(endpoint.kind).toBe("unix_socket");
  expect(endpoint.path).toBe("/tmp/kunai-ipc/kunai-mpv-abc123.sock");
  expect(mpvIpcTransportTag(endpoint)).toBe("unix");
  expect(shouldUnlinkUnixSocket(endpoint)).toBe(true);
});
