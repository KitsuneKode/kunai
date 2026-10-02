import { describe, expect, test } from "bun:test";

import {
  buildMpvIpcCommand,
  MPV_INITIAL_PROPERTIES,
  MPV_OBSERVED_PROPERTIES,
  openMpvIpcSession,
  parseMpvIpcLine,
} from "@/infra/player/mpv-ipc";
import type { MpvIpcSessionOptions } from "@/infra/player/mpv-ipc";

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

async function withFakeMpvSocket(
  closeOnEnd: boolean,
  run: (counts: { readonly end: () => number; readonly terminate: () => number }) => Promise<void>,
): Promise<void> {
  const bun = Bun as unknown as { connect: typeof Bun.connect };
  const originalConnect = bun.connect;
  let endCount = 0;
  let terminateCount = 0;
  bun.connect = (async (rawOptions: unknown) => {
    const options = rawOptions as {
      data: FakeSocketState;
      socket: {
        close(socket: FakeSocket): void;
      };
    };
    const socket: FakeSocket = {
      data: options.data,
      readyState: 1,
      write() {},
      end() {
        endCount++;
        if (closeOnEnd) options.socket.close(socket);
      },
      terminate() {
        terminateCount++;
      },
    };
    return socket;
  }) as typeof Bun.connect;

  try {
    await run({ end: () => endCount, terminate: () => terminateCount });
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
});

type CapturedSocketHandlers = {
  open?(socket: FakeSocket): void;
  data?(socket: FakeSocket, chunk: Uint8Array): void;
  close?(socket: FakeSocket): void;
  error?(socket: FakeSocket, cause: unknown): void;
};

type CapturedPropertyUpdate = Pick<
  Parameters<MpvIpcSessionOptions["onPropertyUpdate"]>[0],
  "name" | "value"
>;

type ConnectCaptureStub = {
  readonly handlers: () => CapturedSocketHandlers;
  readonly socket: () => FakeSocket;
  readonly restore: () => void;
};

/**
 * Stub `Bun.connect` with a socket whose `data` handler the test can drive —
 * needed for split-UTF-8 and buffer-cap coverage, which a write-only stub
 * cannot reach. `makeSocket` overrides the default fake when a test needs a
 * closed or write-failing socket.
 */
function stubConnectCapture(
  makeSocket?: (data: FakeSocketState) => FakeSocket,
): ConnectCaptureStub {
  const bun: { connect: typeof Bun.connect } = Bun;
  const originalConnect = bun.connect;
  let socketHandlers: CapturedSocketHandlers | null = null;
  let fakeSocket: FakeSocket | null = null;
  // SAFETY: Bun.connect's real socket-handler contract accepts the fake; the
  // options object shape is what openMpvIpcSession actually passes at runtime.
  bun.connect = (async (options: Parameters<typeof Bun.connect>[0]) => {
    // SAFETY: the stub only serves openMpvIpcSession, which always passes this
    // options shape; the assertion narrows Bun's wider union to what it sends.
    const opts = options as { data: FakeSocketState; socket: CapturedSocketHandlers };
    socketHandlers = opts.socket;
    fakeSocket = makeSocket?.(opts.data) ?? {
      data: opts.data,
      readyState: 1,
      write() {},
      end() {},
      terminate() {},
    };
    return fakeSocket;
    // SAFETY: the fake socket is deliberately partial — tests only exercise the
    // members FakeSocket defines; openMpvIpcSession never touches the rest.
  }) as typeof Bun.connect;
  return {
    handlers: () => {
      if (socketHandlers === null) throw new Error("Bun.connect was not called");
      return socketHandlers;
    },
    socket: () => {
      if (fakeSocket === null) throw new Error("Bun.connect was not called");
      return fakeSocket;
    },
    restore: () => {
      bun.connect = originalConnect;
    },
  };
}

describe("mpv-ipc receive path", () => {
  test("reassembles a multi-byte UTF-8 character split across socket chunks", async () => {
    const updates: CapturedPropertyUpdate[] = [];
    const stub = stubConnectCapture();
    try {
      await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate: ({ name, value }) => {
          updates.push({ name, value });
        },
        onEndFile() {},
      });

      const line = JSON.stringify({
        event: "property-change",
        name: "media-title",
        data: "titre — 日本語",
      });
      const bytes = new TextEncoder().encode(`${line}\n`);
      // Split inside the multi-byte "—" (U+2014, 3 bytes: e2 80 94).
      const emDashOffset = bytes.indexOf(0xe2);
      const first = bytes.subarray(0, emDashOffset + 1);
      const second = bytes.subarray(emDashOffset + 1);
      const s = stub.socket();
      stub.handlers().data?.(s, first);
      stub.handlers().data?.(s, second);

      expect(updates).toEqual([{ name: "media-title", value: "titre — 日本語" }]);
    } finally {
      stub.restore();
    }
  });

  test("drops an unterminated line past the buffer cap and keeps parsing later lines", async () => {
    const updates: CapturedPropertyUpdate[] = [];
    const stub = stubConnectCapture();
    try {
      await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate: ({ name, value }) => {
          updates.push({ name, value });
        },
        onEndFile() {},
      });

      const s = stub.socket();
      // Larger than MAX_IPC_UNPARSED_BYTES with no newline — must not parse.
      stub.handlers().data?.(s, new Uint8Array(300 * 1024).fill(0x41));
      expect(updates).toEqual([]);

      // A well-formed line after the drop is still handled.
      stub
        .handlers()
        .data?.(
          s,
          new TextEncoder().encode(
            `${JSON.stringify({ event: "property-change", name: "pause", data: true })}\n`,
          ),
        );
      expect(updates).toEqual([{ name: "pause", value: true }]);
    } finally {
      stub.restore();
    }
  });

  test("a throwing onPropertyUpdate does not stop dispatch of later lines in the same chunk", async () => {
    const seen: string[] = [];
    const stub = stubConnectCapture();
    try {
      await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate: ({ name }) => {
          seen.push(name);
          if (name === "pause") throw new Error("consumer exploded");
        },
        onEndFile() {},
      });

      const s = stub.socket();
      stub
        .handlers()
        .data?.(
          s,
          new TextEncoder().encode(
            `${JSON.stringify({ event: "property-change", name: "pause", data: true })}\n` +
              `${JSON.stringify({ event: "property-change", name: "duration", data: 42 })}\n`,
          ),
        );
      // The throw on "pause" is contained; "duration" in the same chunk still lands.
      expect(seen).toEqual(["pause", "duration"]);
    } finally {
      stub.restore();
    }
  });

  test("send() still resolves when onCommandResult throws", async () => {
    const stub = stubConnectCapture((data) => ({
      data,
      readyState: 0,
      write() {},
      end() {},
      terminate() {},
    }));

    try {
      const session = await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate() {},
        onEndFile() {},
        onCommandResult: () => {
          throw new Error("observer exploded");
        },
      });
      // readyState 0 → immediate "session closed" result; the throwing observer
      // must not reject or hang the send promise.
      const result = await session.send(["get_property", "pause"]);
      expect(result).toMatchObject({ ok: false, error: "session closed" });
    } finally {
      stub.restore();
    }
  });

  test("send() resolves a write failure without propagating an onCommandResult throw", async () => {
    let writeCount = 0;
    const stub = stubConnectCapture((data) => ({
      data,
      readyState: 1,
      write() {
        // The bootstrap burst (observe/get_property init payload) is one
        // write that must succeed; every command after it fails.
        writeCount++;
        if (writeCount > 1) throw new Error("write failed");
      },
      end() {},
      terminate() {},
    }));

    try {
      const session = await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
        onPropertyUpdate() {},
        onEndFile() {},
        onCommandResult: () => {
          throw new Error("observer exploded");
        },
      });
      const result = await session.send(["get_property", "pause"], 50);
      expect(result).toMatchObject({ ok: false, error: "write failed" });
    } finally {
      stub.restore();
    }
  });
});
