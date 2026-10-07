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
  readonly drain: () => void;
  readonly setWriteLimit: (limit: number) => void;
};

async function withFakeMpvSocket(
  closeOnEnd: boolean,
  run: (harness: FakeSocketHarness) => Promise<void>,
  initialWriteLimit = Infinity,
): Promise<void> {
  const bun = Bun as unknown as { connect: typeof Bun.connect };
  const originalConnect = bun.connect;
  let writeLimit = initialWriteLimit;
  let endCount = 0;
  let terminateCount = 0;
  const writtenPayloads: string[] = [];
  let currentSocket: FakeSocket | null = null;
  let currentSocketHandler: {
    data?(socket: FakeSocket, data: Buffer): void;
    close?(socket: FakeSocket): void;
    drain?(socket: FakeSocket): void;
  } | null = null;

  bun.connect = (async (rawOptions: unknown) => {
    const options = rawOptions as {
      data: FakeSocketState;
      socket: {
        data?(socket: FakeSocket, data: Buffer): void;
        close(socket: FakeSocket): void;
        drain?(socket: FakeSocket): void;
      };
    };
    currentSocketHandler = options.socket;
    const socket: FakeSocket = {
      data: options.data,
      readyState: 1,
      write(payload: string | Uint8Array) {
        const bytes = Buffer.from(payload);
        const accepted = Math.min(writeLimit, bytes.length);
        if (accepted < 0) return accepted;
        writtenPayloads.push(bytes.subarray(0, accepted).toString("latin1"));
        return accepted;
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
      setWriteLimit: (limit) => {
        writeLimit = limit;
      },
      drain: () => {
        if (!currentSocket) throw new Error("Socket not connected");
        currentSocketHandler?.drain?.(currentSocket);
      },
    });
  } finally {
    bun.connect = originalConnect;
  }
}

type FakeSocket = {
  data: FakeSocketState;
  readyState: number;
  write(data: string | Uint8Array): number;
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

test("partial UTF-8 writes preserve command framing and FIFO order through drain", async () => {
  await withFakeMpvSocket(true, async ({ written, setWriteLimit, drain }) => {
    const session = await openMpvIpcSession({
      endpoint: { kind: "unix_socket", path: "/private/kunai.sock" },
      onPropertyUpdate() {},
      onEndFile() {},
    });
    const prefix = written().join("");
    const command = ["loadfile", "/tmp/🦊.mp4", "replace"];
    // Stop in the middle of the emoji's UTF-8 encoding.
    setWriteLimit(Buffer.from(buildMpvIpcCommand(command)).indexOf(Buffer.from("🦊")) + 1);
    session.sendUnchecked(command);
    setWriteLimit(0);
    session.sendUnchecked(["set_property", "pause", false]);
    setWriteLimit(Infinity);
    drain();
    const delivered = Buffer.from(written().join("").slice(prefix.length), "latin1").toString(
      "utf8",
    );
    expect(delivered).toBe(
      buildMpvIpcCommand(command) + buildMpvIpcCommand(["set_property", "pause", false]),
    );
    await session.close();
  });
});

test("close discards queued commands so a later drain cannot revive playback", async () => {
  await withFakeMpvSocket(true, async ({ written, setWriteLimit, drain }) => {
    const session = await openMpvIpcSession({
      endpoint: { kind: "windows_pipe", path: "fixture-pipe" },
      onPropertyUpdate() {},
      onEndFile() {},
    });
    setWriteLimit(0);
    const command = session.send(["loadfile", "fixture.mp4", "replace"]);
    await session.close();
    const prefix = written().join("");
    setWriteLimit(Infinity);
    drain();
    expect((await command).ok).toBe(false);
    expect(written().join("")).toBe(prefix);
  });
});

test("subscriptions finish before commands even when the initial write stalls", async () => {
  await withFakeMpvSocket(
    true,
    async ({ written, setWriteLimit, drain }) => {
      const session = await openMpvIpcSession({
        endpoint: { kind: "unix_socket", path: "fixture" },
        onPropertyUpdate() {},
        onEndFile() {},
      });
      session.sendUnchecked(["quit"]);
      expect(written().join("")).toHaveLength(1);
      setWriteLimit(Infinity);
      drain();
      const commands = written()
        .join("")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).command);
      expect(commands).toHaveLength(
        MPV_OBSERVED_PROPERTIES.length + MPV_INITIAL_PROPERTIES.length + 1,
      );
      expect(commands.at(-1)).toEqual(["quit"]);
      await session.close();
    },
    1,
  );
});

test.each([false, true])("deadline cancels stalled writes safely (partial=%s)", async (partial) => {
  const clock = createCloseTimerHarness();
  await withFakeMpvSocket(true, async ({ setWriteLimit, written, drain, terminate }) => {
    const session = await openMpvIpcSession({
      endpoint: { kind: "unix_socket", path: "fixture" },
      onPropertyUpdate() {},
      onEndFile() {},
      commandTimers: clock.timers,
    });
    const prefix = written().join("");
    setWriteLimit(partial ? 7 : 0);
    const command = session.send(["loadfile", "expired.mp4", "replace"]);
    const following = session.send(["set_property", "pause", true]);
    clock.scheduled[0]!.callback();
    expect(await command).toMatchObject({ ok: false, error: "timeout" });
    setWriteLimit(Infinity);
    drain();
    if (partial) {
      expect(terminate()).toBe(1);
      expect(await following).toMatchObject({ ok: false, error: "partial IPC write timed out" });
      expect(written().join("").slice(prefix.length)).toHaveLength(7);
    } else {
      expect(terminate()).toBe(0);
      expect(written().join("").slice(prefix.length)).not.toContain("expired.mp4");
    }
    await session.close();
    if (!partial) expect(await following).toMatchObject({ ok: false, error: "session closed" });
    expect(clock.cleared).toEqual([1, 2]);
  });
});

test("a stalled peer cannot retain an unbounded command backlog", async () => {
  await withFakeMpvSocket(true, async ({ setWriteLimit, written, drain }) => {
    const session = await openMpvIpcSession({
      endpoint: { kind: "windows_pipe", path: "fixture" },
      onPropertyUpdate() {},
      onEndFile() {},
    });
    const prefix = written().join("");
    setWriteLimit(0);
    session.sendUnchecked(["loadfile", "x".repeat(200_000)]);
    const rejected = await session.send(["loadfile", "y".repeat(100_000)]);
    expect(rejected).toMatchObject({ ok: false, error: "mpv IPC write queue is full" });
    setWriteLimit(Infinity);
    drain();
    expect(written().join("").slice(prefix.length)).not.toContain("yyyy");
    await session.close();
  });
});

test("a closed writer settles commands once and rejects later admission", async () => {
  await withFakeMpvSocket(true, async ({ setWriteLimit, terminate }) => {
    let completions = 0;
    const session = await openMpvIpcSession({
      endpoint: { kind: "unix_socket", path: "fixture" },
      onPropertyUpdate() {},
      onEndFile() {},
      onCommandResult() {
        completions += 1;
      },
    });
    setWriteLimit(-1);
    expect(await session.send(["seek", 10])).toMatchObject({
      ok: false,
      error: "mpv IPC socket is closed",
    });
    expect(completions).toBe(1);
    expect(terminate()).toBe(1);
    expect(await session.send(["quit"])).toMatchObject({ ok: false, error: "session closed" });
    expect(completions).toBe(2);
    await session.close();
  });
});

test("initial write failure rejects session opening", async () => {
  await withFakeMpvSocket(
    true,
    async () => {
      await expect(
        openMpvIpcSession({
          endpoint: { kind: "unix_socket", path: "fixture" },
          onPropertyUpdate() {},
          onEndFile() {},
        }),
      ).rejects.toThrow("mpv IPC session is closed");
    },
    -1,
  );
});
