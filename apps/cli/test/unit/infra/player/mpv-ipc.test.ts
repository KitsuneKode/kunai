import { describe, expect, test } from "bun:test";

import {
  buildMpvIpcCommand,
  MPV_INITIAL_PROPERTIES,
  MPV_OBSERVED_PROPERTIES,
  openMpvIpcSession,
  parseMpvIpcLine,
} from "@/infra/player/mpv-ipc";

type FakeSocketState = { onClose: (() => void) | null };

type CloseTimerHarness = {
  readonly scheduled: Array<{ id: number; callback: () => void; delayMs: number }>;
  readonly cleared: number[];
  readonly timers: {
    setTimeout(callback: () => void, delayMs: number): number;
    clearTimeout(handle: unknown): void;
  };
};

function createCloseTimerHarness(): CloseTimerHarness {
  const scheduled: CloseTimerHarness["scheduled"] = [];
  const cleared: number[] = [];
  return {
    scheduled,
    cleared,
    timers: {
      setTimeout(callback, delayMs) {
        const id = scheduled.length + 1;
        scheduled.push({ id, callback, delayMs });
        return id;
      },
      clearTimeout(handle) {
        if (typeof handle !== "number") throw new Error("unexpected timer handle");
        cleared.push(handle);
      },
    },
  };
}

type FakeSocketHarness = {
  readonly end: () => number;
  readonly terminate: () => number;
  readonly emitData: (chunk: Buffer) => void;
  readonly written: () => readonly string[];
};

async function withFakeMpvSocket(
  closeOnEnd: boolean,
  run: (harness: FakeSocketHarness) => Promise<void>,
): Promise<void> {
  const bun = Bun as unknown as { connect: typeof Bun.connect };
  const originalConnect = bun.connect;
  let endCount = 0;
  let terminateCount = 0;
  const writtenPayloads: string[] = [];
  let currentSocket: FakeSocket | null = null;
  let currentSocketHandler: {
    data?(socket: FakeSocket, data: Buffer): void;
    close?(socket: FakeSocket): void;
  } | null = null;

  bun.connect = (async (rawOptions: unknown) => {
    const options = rawOptions as {
      data: FakeSocketState;
      socket: {
        data?(socket: FakeSocket, data: Buffer): void;
        close(socket: FakeSocket): void;
      };
    };
    currentSocketHandler = options.socket;
    const socket: FakeSocket = {
      data: options.data,
      readyState: 1,
      write(payload: string) {
        writtenPayloads.push(payload);
      },
      end() {
        endCount++;
        if (closeOnEnd) options.socket.close(socket);
      },
      terminate() {
        terminateCount++;
      },
    };
    currentSocket = socket;
    return socket;
  }) as typeof Bun.connect;

  try {
    await run({
      end: () => endCount,
      terminate: () => terminateCount,
      emitData: (chunk: Buffer) => {
        if (!currentSocket || !currentSocketHandler?.data) throw new Error("Socket not connected");
        currentSocketHandler.data(currentSocket, chunk);
      },
      written: () => writtenPayloads,
    });
  } finally {
    bun.connect = originalConnect;
  }
}

type FakeSocket = {
  data: FakeSocketState;
  readyState: number;
  write(data: string): void;
  end(): void;
  terminate(): void;
};

describe("mpv-ipc", () => {
  test("builds newline-delimited ipc commands without a request id", () => {
    expect(buildMpvIpcCommand(["get_property", "duration"])).toBe(
      `${JSON.stringify({ command: ["get_property", "duration"] })}\n`,
    );
  });

  test("builds newline-delimited ipc commands with a request id", () => {
    expect(buildMpvIpcCommand(["observe_property", 4, "time-pos"], 4)).toBe(
      `${JSON.stringify({ command: ["observe_property", 4, "time-pos"], request_id: 4 })}\n`,
    );
  });

  test("builds playback control ipc commands", () => {
    expect(buildMpvIpcCommand(["quit"])).toBe(`${JSON.stringify({ command: ["quit"] })}\n`);
    expect(buildMpvIpcCommand(["sub-reload"])).toBe(
      `${JSON.stringify({ command: ["sub-reload"] })}\n`,
    );
  });

  test("parses valid newline-delimited ipc payloads", () => {
    expect(parseMpvIpcLine('{"event":"property-change","name":"duration","data":1440}\n')).toEqual({
      event: "property-change",
      name: "duration",
      data: 1440,
    });
  });

  test("returns null for empty or invalid lines", () => {
    expect(parseMpvIpcLine("")).toBeNull();
    expect(parseMpvIpcLine("not-json")).toBeNull();
    expect(parseMpvIpcLine("[]")).toBeNull();
  });

  test("requests the expected initial and observed properties", () => {
    expect(MPV_INITIAL_PROPERTIES).toEqual(["playback-time", "duration", "percent-pos"]);
    expect(MPV_OBSERVED_PROPERTIES).toEqual([
      "time-pos",
      "playback-time",
      "duration",
      "percent-pos",
      "pause",
      "seeking",
      "paused-for-cache",
      "cache-buffering-state",
      "demuxer-cache-duration",
      "demuxer-cache-state",
      "demuxer-via-network",
      "cache-speed",
      "vo-configured",
      "eof-reached",
      "idle-active",
      "core-idle",
      "filename",
      "media-title",
      "track-list",
    ]);
  });

  test("parses successful command responses with request ids", () => {
    expect(parseMpvIpcLine('{"request_id":12,"error":"success","data":true}\n')).toEqual({
      request_id: 12,
      error: "success",
      data: true,
    });
  });

  test("clean socket close clears the 200ms terminate fallback", async () => {
    const clock = createCloseTimerHarness();

    await withFakeMpvSocket(true, async (counts) => {
      const session = await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate() {},
        onEndFile() {},
        closeTimers: clock.timers,
      });

      await session.close();

      expect(clock.scheduled.map(({ id, delayMs }) => ({ id, delayMs }))).toEqual([
        { id: 1, delayMs: 200 },
      ]);
      expect(clock.cleared).toEqual([1]);
      expect(counts.end()).toBe(1);
      expect(counts.terminate()).toBe(0);
    });
  });

  test("terminate fallback resolves close exactly once when close never arrives", async () => {
    const clock = createCloseTimerHarness();

    await withFakeMpvSocket(false, async (counts) => {
      const session = await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate() {},
        onEndFile() {},
        closeTimers: clock.timers,
      });

      let resolutionCount = 0;
      const closePromise = session.close().then(() => {
        resolutionCount++;
        return undefined;
      });
      expect(clock.scheduled.map(({ id, delayMs }) => ({ id, delayMs }))).toEqual([
        { id: 1, delayMs: 200 },
      ]);

      clock.scheduled[0]?.callback();
      await closePromise;
      expect(counts.end()).toBe(1);
      expect(counts.terminate()).toBe(1);
      expect(resolutionCount).toBe(1);

      clock.scheduled[0]?.callback();
      await Promise.resolve();
      expect(counts.terminate()).toBe(1);
      expect(resolutionCount).toBe(1);
    });
  });

  test("reassembles fragmented multi-byte UTF-8 chunks without replacement character corruption", async () => {
    const propertyUpdates: Array<{ name: string; value: unknown }> = [];
    await withFakeMpvSocket(true, async ({ emitData }) => {
      const session = await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate({ name, value }) {
          propertyUpdates.push({ name, value });
        },
        onEndFile() {},
      });

      const fullMessage = Buffer.from(
        '{"event":"property-change","name":"media-title","data":"🦊"}\n',
        "utf8",
      );
      const emojiIndex = fullMessage.indexOf(Buffer.from("🦊"));
      const chunk1 = fullMessage.subarray(0, emojiIndex + 2);
      const chunk2 = fullMessage.subarray(emojiIndex + 2);

      emitData(chunk1);
      emitData(chunk2);

      expect(propertyUpdates).toEqual([{ name: "media-title", value: "🦊" }]);
      await session.close();
    });
  });

  test("cleans up command request tracking on error responses", async () => {
    await withFakeMpvSocket(true, async ({ emitData, written }) => {
      const session = await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate() {},
        onEndFile() {},
      });

      const cmdPromise = session.send(["bad_command"]);
      const payloads = written();
      // SAFETY: Harness verifies command payload serialized with request_id
      const lastPayload = JSON.parse(payloads[payloads.length - 1]!) as { request_id: number };

      emitData(
        Buffer.from(
          JSON.stringify({
            request_id: lastPayload.request_id,
            error: "command not found",
          }) + "\n",
          "utf8",
        ),
      );

      const result = await cmdPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("command not found");
      }

      await session.close();
    });
  });
});
