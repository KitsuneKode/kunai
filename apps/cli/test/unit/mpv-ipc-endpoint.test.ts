import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  mpvIpcTransportTag,
  shouldUnlinkUnixSocket,
  sweepStaleMpvIpcArtifacts,
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

/** A real bound unix socket gives the sweep an honest socket inode to judge. */
function bindTestSocket(path: string) {
  const server = Bun.listen({
    unix: path,
    socket: {
      data() {},
      open() {},
      close() {},
      error() {},
    },
  });
  return { stop: () => server.stop(true) };
}

function ipcDirUnder(root: string): string {
  const dir = join(root, "kunai-ipc");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// POSIX-only: the sweep is unreachable on Windows (the endpoint returns a
// named pipe before it runs), and Windows fs does not mark AF_UNIX inodes
// isSocket() anyway — the lstat guard would skip every unlink there.
test.skipIf(process.platform === "win32")(
  "sweep unlinks a dead socket and its conf, keeps a live pair",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-ipc-sweep-"));
    const dir = ipcDirUnder(root);

    const deadSock = join(dir, "kunai-mpv-dead.sock");
    const liveSock = join(dir, "kunai-mpv-live.sock");
    const dead = bindTestSocket(deadSock);
    const live = bindTestSocket(liveSock);
    writeFileSync(`${deadSock}.conf`, "http-header-fields=Cookie: dead=1\n");
    writeFileSync(`${liveSock}.conf`, "http-header-fields=Cookie: live=1\n");

    try {
      // The probe, not file existence, decides: `dead` is reported dead even
      // though its socket inode is bound — the liveness verdict is the contract.
      await sweepStaleMpvIpcArtifacts({ TMPDIR: root }, async (path) => path === liveSock);

      expect(existsSync(deadSock)).toBe(false);
      expect(existsSync(`${deadSock}.conf`)).toBe(false);
      expect(existsSync(liveSock)).toBe(true);
      expect(existsSync(`${liveSock}.conf`)).toBe(true);
    } finally {
      dead.stop();
      live.stop();
    }
  },
);

test("sweep removes only aged orphan confs so an in-flight spawn's conf survives", async () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-ipc-sweep-"));
  const dir = ipcDirUnder(root);

  // Confs whose `.sock` sibling was never bound (crash between write and bind).
  const staleConf = join(dir, "kunai-mpv-crashed.sock.conf");
  const freshConf = join(dir, "kunai-mpv-inflight.sock.conf");
  writeFileSync(staleConf, "http-header-fields=Cookie: old=1\n");
  writeFileSync(freshConf, "http-header-fields=Cookie: new=1\n");
  const old = new Date(Date.now() - 120_000);
  utimesSync(staleConf, old, old);

  await sweepStaleMpvIpcArtifacts({ TMPDIR: root }, async () => false);

  expect(existsSync(staleConf)).toBe(false);
  expect(existsSync(freshConf)).toBe(true);
});
