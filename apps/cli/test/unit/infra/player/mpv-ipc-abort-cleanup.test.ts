import { expect, test } from "bun:test";

import type { MpvIpcSession } from "@/infra/player/mpv-ipc";
import { cleanupAbortedMpvLaunch } from "@/mpv";

test("preflight abort waits for a late IPC session before closing and cleaning its socket", async () => {
  let releaseBootstrap: (() => void) | undefined;
  const ipcBootstrap = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });
  const session = {
    send: async () => ({ ok: false, command: [], requestId: 0, error: "unused" }) as const,
    sendUnchecked: () => {},
    close: async () => {},
  } satisfies MpvIpcSession;
  let activeSession: MpvIpcSession | null = null;
  const events: string[] = [];

  const cleanup = cleanupAbortedMpvLaunch({
    ipcBootstrap,
    getIpcSession: () => activeSession,
    closeIpcSession: async (candidate) => {
      expect(candidate).toBe(session);
      events.push("session-closed");
    },
    cleanupSocket: async () => {
      events.push("socket-cleaned");
      return true;
    },
  });

  activeSession = session;
  releaseBootstrap?.();

  await expect(cleanup).resolves.toBe(true);
  expect(events).toEqual(["session-closed", "socket-cleaned"]);
});
