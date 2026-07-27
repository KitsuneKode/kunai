import { afterEach, expect, test } from "bun:test";

import { waitForMpvIpcEndpoint } from "@/infra/player/mpv-ipc";
import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  newMpvIpcSessionId,
  shouldUnlinkUnixSocket,
} from "@/infra/player/mpv-ipc-endpoint";

/**
 * Proves the IPC endpoint against a real mpv, on whatever platform runs it.
 *
 * The unit test locks the *spelling* of the endpoint; it cannot detect the
 * failure that spelling caused, because mpv fails silently. Handed
 * `//./pipe/NAME` on Windows, mpv starts normally, prints no error, exits
 * non-zero for nothing -- and never creates the pipe. Every connect then failed,
 * Kunai read that as a dead player, and fell back by launching another mpv for a
 * stream already playing. Nothing short of launching mpv and connecting catches
 * that, which is why it shipped.
 *
 * Not Windows-only on purpose: the same test is the Unix-socket contract, and a
 * change that breaks one spelling usually touches both.
 */
const MPV_BIN = Bun.which("mpv");

/**
 * mpv is a runtime dependency, not something this suite can assert into
 * existence. A machine without it cannot answer the question, so say that rather
 * than report a red test. Mirrors the `nodeAvailable()` gate in the npm suites.
 */
const mpvTest = MPV_BIN ? test : test.skip;

let child: ReturnType<typeof Bun.spawn> | null = null;
let socketPath: string | null = null;

afterEach(async () => {
  if (child) {
    child.kill();
    // Await exit so the pipe/socket is released before the next case binds a
    // new one, and so no mpv outlives the suite.
    await child.exited.catch(() => {});
    child = null;
  }
  if (socketPath) {
    await Bun.file(socketPath)
      .unlink()
      .catch(() => {});
    socketPath = null;
  }
});

function spawnIdleMpv(ipcArg: string): ReturnType<typeof Bun.spawn> {
  return Bun.spawn({
    // --idle keeps mpv alive with no file; --vo=null --ao=null keep CI headless.
    cmd: [
      MPV_BIN as string,
      "--idle=yes",
      "--no-config",
      "--vo=null",
      "--ao=null",
      "--really-quiet",
      `--input-ipc-server=${ipcArg}`,
    ],
    stdout: "ignore",
    stderr: "ignore",
  });
}

mpvTest("real mpv binds the endpoint Kunai builds, and Bun connects to it", async () => {
  const endpoint = createMpvIpcEndpoint(newMpvIpcSessionId());
  const ipcArg = ipcServerCliArg(endpoint);
  if (shouldUnlinkUnixSocket(endpoint)) socketPath = endpoint.path;

  child = spawnIdleMpv(ipcArg);

  // The exact production probe, so a regression here is a regression there.
  const ready = await waitForMpvIpcEndpoint(endpoint, 10_000);
  expect(
    ready,
    `mpv never bound ${ipcArg} — it accepts this value silently and never creates the endpoint`,
  ).toBe(true);
});

mpvTest("a JSON IPC command round-trips over the endpoint", async () => {
  const endpoint = createMpvIpcEndpoint(newMpvIpcSessionId());
  if (shouldUnlinkUnixSocket(endpoint)) socketPath = endpoint.path;

  child = spawnIdleMpv(ipcServerCliArg(endpoint));
  expect(await waitForMpvIpcEndpoint(endpoint, 10_000)).toBe(true);

  const reply = await new Promise<string>((resolve, reject) => {
    // Binding alone proves the path is right; a command proves the transport
    // actually carries framed JSON both ways, which is what playback depends on.
    const timer = setTimeout(() => reject(new Error("no IPC reply within 5s")), 5_000);
    let buffer = "";
    void Bun.connect<Record<string, never>>({
      unix: endpoint.path,
      data: {},
      socket: {
        open(sock) {
          sock.write(`${JSON.stringify({ command: ["get_property", "mpv-version"] })}\n`);
        },
        data(sock, chunk) {
          buffer += chunk.toString();
          // mpv answers newline-delimited JSON and may emit events first, so
          // settle on the first complete line that is actually our reply.
          for (const line of buffer.split("\n")) {
            if (line.includes('"error"')) {
              clearTimeout(timer);
              sock.end();
              resolve(line);
              return;
            }
          }
        },
        close() {},
        error(_sock, error) {
          clearTimeout(timer);
          reject(error);
        },
      },
    }).catch(reject);
  });

  const parsed = JSON.parse(reply) as { error: string; data?: string };
  expect(parsed.error).toBe("success");
  expect(parsed.data).toMatch(/^mpv /);
});
