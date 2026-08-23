import { describe, expect, test } from "bun:test";

import {
  createDiscordIpcClient,
  decodeDiscordIpcPacket,
  encodeDiscordIpcPacket,
  resolveDiscordIpcEndpointCandidates,
  tryDecodeDiscordIpcPacket,
  MAX_DISCORD_IPC_BUFFER_BYTES,
  MAX_DISCORD_IPC_FRAME_BYTES,
  type DiscordIpcConnector,
  type DiscordIpcSocket,
} from "@/services/presence/discord-ipc-client";

type FakeConnectorOptions = {
  readonly firstAttemptDataBeforeReject?: Uint8Array;
  readonly onWrite?: (writeNumber: number, data: Uint8Array) => void;
  readonly readyThenThrowOnWriteNumber?: number;
  readonly throwOnWriteNumber?: number;
  readonly throwOnEnd?: boolean;
  readonly terminalBeforeResolve?: "close" | "error";
  readonly terminalOnWrite?: {
    readonly number: number;
    readonly event: "close" | "error";
  };
};

function createFakeConnector(options: FakeConnectorOptions = {}): {
  connector: DiscordIpcConnector;
  writes: Uint8Array[];
  endpointAttempts: string[];
  ended: boolean;
  pushPacket(packet: Record<string, unknown>, op?: number): void;
  pushRaw(data: Uint8Array): void;
  pushPacketFromAttempt(attempt: number, packet: Record<string, unknown>, op?: number): void;
  pushRawFromAttempt(attempt: number, data: Uint8Array): void;
  closeAttempt(attempt: number): void;
  errorAttempt(attempt: number, error: unknown): void;
  close(): void;
} {
  const writes: Uint8Array[] = [];
  const endpointAttempts: string[] = [];
  const callbackAttempts: Parameters<DiscordIpcConnector>[1][] = [];
  let activeCallbacks: Parameters<DiscordIpcConnector>[1] | null = null;

  const state = {
    writes,
    endpointAttempts,
    ended: false,
    connector: (async (endpoint, callbacks) => {
      endpointAttempts.push(endpoint);
      callbackAttempts.push(callbacks);
      activeCallbacks = callbacks;
      if (endpointAttempts.length === 1 && options.firstAttemptDataBeforeReject) {
        callbacks.onData(options.firstAttemptDataBeforeReject);
        throw new Error("fake first Discord endpoint rejected");
      }
      if (options.terminalBeforeResolve === "close") callbacks.onClose();
      if (options.terminalBeforeResolve === "error") {
        callbacks.onError(new Error("fake Discord error before connect resolved"));
      }
      return socket;
    }) as DiscordIpcConnector,
    pushPacket(packet: Record<string, unknown>, op = 1) {
      activeCallbacks?.onData(encodeDiscordIpcPacket(op, packet));
    },
    /** Bytes exactly as given — for frames `encodeDiscordIpcPacket` cannot produce. */
    pushRaw(data: Uint8Array) {
      activeCallbacks?.onData(data);
    },
    pushPacketFromAttempt(attempt: number, packet: Record<string, unknown>, op = 1) {
      callbackAttempts[attempt]?.onData(encodeDiscordIpcPacket(op, packet));
    },
    pushRawFromAttempt(attempt: number, data: Uint8Array) {
      callbackAttempts[attempt]?.onData(data);
    },
    closeAttempt(attempt: number) {
      callbackAttempts[attempt]?.onClose();
    },
    errorAttempt(attempt: number, error: unknown) {
      callbackAttempts[attempt]?.onError(error);
    },
    close() {
      activeCallbacks?.onClose();
    },
  };

  const socket: DiscordIpcSocket = {
    write(data) {
      const writeNumber = writes.length + 1;
      if (writeNumber === options.throwOnWriteNumber) {
        throw new Error("fake Discord write failed");
      }
      writes.push(data);
      options.onWrite?.(writeNumber, data);
      if (writeNumber === options.readyThenThrowOnWriteNumber) {
        activeCallbacks?.onData(encodeDiscordIpcPacket(1, { cmd: "DISPATCH", evt: "READY" }));
        throw new Error("fake Discord write failed after READY");
      }
      if (writeNumber === options.terminalOnWrite?.number) {
        if (options.terminalOnWrite.event === "close") activeCallbacks?.onClose();
        else activeCallbacks?.onError(new Error("fake synchronous Discord write error"));
      }
    },
    end() {
      state.ended = true;
      if (options.throwOnEnd) throw new Error("fake Discord end failed");
      activeCallbacks?.onClose();
    },
  };

  return state;
}

function createDistinctSocketConnector(
  options: {
    readonly onWrite?: (attempt: number, data: Uint8Array) => void;
  } = {},
): {
  readonly connector: DiscordIpcConnector;
  readonly callbacks: Parameters<DiscordIpcConnector>[1][];
  readonly writes: Array<{ readonly attempt: number; readonly data: Uint8Array }>;
  readonly ended: number[];
  pushPacket(attempt: number, packet: Record<string, unknown>, op?: number): void;
} {
  const callbacks: Parameters<DiscordIpcConnector>[1][] = [];
  const writes: Array<{ readonly attempt: number; readonly data: Uint8Array }> = [];
  const ended: number[] = [];
  return {
    callbacks,
    writes,
    ended,
    connector: (async (_endpoint, attemptCallbacks) => {
      const attempt = callbacks.length;
      callbacks.push(attemptCallbacks);
      ended[attempt] = 0;
      return {
        write(data) {
          writes.push({ attempt, data });
          options.onWrite?.(attempt, data);
        },
        end() {
          ended[attempt] = (ended[attempt] ?? 0) + 1;
        },
      };
    }) as DiscordIpcConnector,
    pushPacket(attempt, packet, op = 1) {
      callbacks[attempt]?.onData(encodeDiscordIpcPacket(op, packet));
    },
  };
}

/** A well-formed 8-byte header whose body is whatever bytes you pass. */
function framedBytes(op: number, body: Uint8Array): Uint8Array {
  const packet = new Uint8Array(8 + body.byteLength);
  const view = new DataView(packet.buffer);
  view.setUint32(0, op, true);
  view.setUint32(4, body.byteLength, true);
  packet.set(body, 8);
  return packet;
}

function jsonObjectBody(byteLength: number): Uint8Array {
  return new TextEncoder().encode(`{"x":"${"x".repeat(byteLength - 8)}"}`);
}

function joinBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Presence is best-effort and optional. A throw inside the `Bun.connect` data
 * callback is an uncaught exception, not a rejected promise, and `main.ts`
 * escalates those to a fatal shutdown — so anything reaching it from here ends
 * the user's playback session. These pin that it cannot.
 */
describe("discord-ipc-client malformed input containment", () => {
  test("a deeply nested PING is echoed without re-serializing attacker-controlled JSON", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    const update = client.setActivity({ details: "Still connected" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    const nesting = 450_000;
    const bodyText = `{"x":${"[".repeat(nesting)}0${"]".repeat(nesting)}}`;
    const body = new TextEncoder().encode(bodyText);
    expect(body.byteLength).toBe(900_007);

    expect(() => fake.pushRaw(framedBytes(3, body))).not.toThrow();
    expect(fake.ended).toBe(false);
    const pong = fake.writes.at(-1) ?? new Uint8Array();
    expect(new DataView(pong.buffer, pong.byteOffset, pong.byteLength).getUint32(0, true)).toBe(4);
    expect(new TextDecoder().decode(pong.subarray(8))).toBe(bodyText);

    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    await expect(update).resolves.toBeUndefined();
  });

  test("throwing callback-path write and teardown stay contained inside Discord", async () => {
    const fake = createFakeConnector({ throwOnWriteNumber: 3, throwOnEnd: true });
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    const pending = client.setActivity({ details: "Pending" });
    const rejection = pending.then(
      () => null,
      (error) => error as Error,
    );

    expect(() => fake.pushPacket({ heartbeat: 1 }, 3)).not.toThrow();
    expect(fake.ended).toBe(true);
    expect(await rejection).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/Discord IPC/i) }),
    );
  });

  test("an unstringifiable socket error cannot escape its callback", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });
    await login;
    const hostileError = {
      [Symbol.toPrimitive]() {
        throw new Error("hostile conversion escaped");
      },
    };

    expect(() => fake.errorAttempt(0, hostileError)).not.toThrow();

    const secondLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    expect(fake.endpointAttempts).toHaveLength(2);
    fake.pushPacketFromAttempt(1, { cmd: "DISPATCH", evt: "READY" });
    await expect(secondLogin).resolves.toBeUndefined();
  });

  test("a Proxy socket error with a throwing prototype trap cannot escape onError", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });
    await login;
    const hostileError = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("hostile prototype lookup escaped");
        },
      },
    );

    expect(() => fake.errorAttempt(0, hostileError)).not.toThrow();

    const secondLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    expect(fake.endpointAttempts).toHaveLength(2);
    fake.pushPacketFromAttempt(1, { cmd: "DISPATCH", evt: "READY" });
    await expect(secondLogin).resolves.toBeUndefined();
  });

  test("a throwing ready observer cannot terminate a healthy Discord connection", async () => {
    const fake = createFakeConnector();
    let laterObserverCalls = 0;
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    client.on("ready", () => {
      throw new Error("presence observer failed");
    });
    client.on("ready", () => {
      laterObserverCalls += 1;
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();

    expect(() => fake.pushPacket({ cmd: "DISPATCH", evt: "READY" })).not.toThrow();
    await expect(login).resolves.toBeUndefined();
    expect(laterObserverCalls).toBe(1);

    const update = client.setActivity({ details: "Observer failure contained" });
    const updateOutcome = update.then(
      () => null,
      (error) => error as Error,
    );
    expect(fake.writes).toHaveLength(2);
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    expect(await updateOutcome).toBeNull();
    expect(fake.ended).toBe(false);
  });

  test("READY followed by protocol CLOSE in one callback rejects login truthfully", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    const batch = joinBytes(
      encodeDiscordIpcPacket(1, { cmd: "DISPATCH", evt: "READY" }),
      encodeDiscordIpcPacket(2, { message: "Discord closed after READY" }),
    );

    expect(() => fake.pushRaw(batch)).not.toThrow();
    const loginError = await login.then(
      () => null,
      (error) => error as Error,
    );
    const activityError = await client.setActivity({ details: "Must not send" }).then(
      () => null,
      (error) => error as Error,
    );

    expect(loginError).toEqual(
      expect.objectContaining({ message: expect.stringContaining("Discord closed after READY") }),
    );
    expect(activityError).toEqual(
      expect.objectContaining({ message: "Discord IPC is not connected" }),
    );
  });

  test("a handshake write that delivers READY and then throws cannot resolve login", async () => {
    const fake = createFakeConnector({ readyThenThrowOnWriteNumber: 1 });
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });

    const loginError = await client.login({ clientId: "client-1" }).then(
      () => null,
      (error) => error as Error,
    );
    const activityError = await client.setActivity({ details: "Must not send" }).then(
      () => null,
      (error) => error as Error,
    );

    expect(loginError).toEqual(
      expect.objectContaining({ message: "fake Discord write failed after READY" }),
    );
    expect(activityError).toEqual(
      expect.objectContaining({ message: "Discord IPC is not connected" }),
    );
    expect(fake.ended).toBe(true);
  });

  test("ready fast-path rechecks ownership after hostile error classification", async () => {
    const fake = createDistinctSocketConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    for (let turn = 0; turn < 8 && fake.writes.length === 0; turn += 1) {
      await Promise.resolve();
    }
    fake.pushPacket(0, { cmd: "DISPATCH", evt: "READY" });
    await firstLogin;

    let reentrantLogin: Promise<void> | null = null;
    let reentrantOutcome: "resolved" | "rejected" | null = null;
    const hostileError = new Proxy(
      {},
      {
        getPrototypeOf() {
          reentrantLogin ??= client.login({ clientId: "client-1" });
          void reentrantLogin.then(
            () => {
              reentrantOutcome = "resolved";
              return undefined;
            },
            () => {
              reentrantOutcome = "rejected";
              return undefined;
            },
          );
          return Object.prototype;
        },
      },
    );

    expect(() => fake.callbacks[0]?.onError(hostileError)).not.toThrow();
    for (let turn = 0; turn < 8 && !fake.writes.some((write) => write.attempt === 1); turn += 1) {
      await Promise.resolve();
    }

    expect(reentrantOutcome).toBeNull();
    expect(fake.writes.filter((write) => write.attempt === 1)).toHaveLength(1);
    fake.pushPacket(1, { cmd: "DISPATCH", evt: "READY" });
    await expect(reentrantLogin).resolves.toBeUndefined();
    expect(fake.ended).toEqual([1, 0]);
  });

  test("a command write that re-enters login and throws cannot satisfy login from stale READY", async () => {
    let client: ReturnType<typeof createDiscordIpcClient>;
    let reentrantLogin: Promise<void> | null = null;
    let reentrantOutcome: "resolved" | "rejected" | null = null;
    const fake = createDistinctSocketConnector({
      onWrite(attempt, data) {
        const op = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
        if (attempt !== 0 || op !== 1) return;
        reentrantLogin = client.login({ clientId: "client-1" });
        void reentrantLogin.then(
          () => {
            reentrantOutcome = "resolved";
            return undefined;
          },
          () => {
            reentrantOutcome = "rejected";
            return undefined;
          },
        );
        throw new Error("fake activity write failed after reentrant login");
      },
    });
    client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    for (let turn = 0; turn < 8 && fake.writes.length === 0; turn += 1) {
      await Promise.resolve();
    }
    fake.pushPacket(0, { cmd: "DISPATCH", evt: "READY" });
    await firstLogin;

    const activity = client.setActivity({ details: "Must fail with its socket" });
    await expect(activity).rejects.toThrow("fake activity write failed after reentrant login");
    for (let turn = 0; turn < 8 && !fake.writes.some((write) => write.attempt === 1); turn += 1) {
      await Promise.resolve();
    }

    expect(reentrantOutcome).toBeNull();
    expect(fake.writes.filter((write) => write.attempt === 1)).toHaveLength(1);
    fake.pushPacket(1, { cmd: "DISPATCH", evt: "READY" });
    await expect(reentrantLogin).resolves.toBeUndefined();
    expect(fake.ended).toEqual([1, 0]);
  });

  test("destroy detaches before CLOSE can synchronously deliver READY", async () => {
    let client: ReturnType<typeof createDiscordIpcClient>;
    let fake: ReturnType<typeof createFakeConnector>;
    let destroying = false;
    let closingReadyObserverCalls = 0;
    let observerLogin: Promise<void> | null = null;
    let observerActivity: Promise<void> | null = null;
    fake = createFakeConnector({
      onWrite(writeNumber) {
        if (writeNumber === 2) {
          fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
        }
      },
    });
    client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });
    client.on("ready", () => {
      if (!destroying) return;
      closingReadyObserverCalls += 1;
      observerLogin = client.login({ clientId: "client-1" });
      observerActivity = client.setActivity({ details: "Must not follow CLOSE" });
      void observerLogin.catch(() => undefined);
      void observerActivity.catch(() => undefined);
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    destroying = true;
    await expect(client.destroy()).resolves.toBeUndefined();

    expect(closingReadyObserverCalls).toBe(0);
    expect(observerLogin).toBeNull();
    expect(observerActivity).toBeNull();
    expect(fake.writes.map((packet) => decodeDiscordIpcPacket(packet).op)).toEqual([0, 2]);
    expect(fake.ended).toBe(true);
  });

  test("close and error invalidate their generation before a late READY", async () => {
    for (const terminalEvent of ["close", "error"] as const) {
      const fake = createFakeConnector();
      const client = createDiscordIpcClient({
        connector: fake.connector,
        endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
        timeoutMs: 500,
      });
      const firstLogin = client.login({ clientId: `client-${terminalEvent}` });
      await Promise.resolve();
      fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });
      await firstLogin;

      if (terminalEvent === "close") {
        fake.closeAttempt(0);
      } else {
        fake.errorAttempt(0, new Error("fake Discord error"));
      }
      fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });

      const secondLogin = client.login({ clientId: `client-${terminalEvent}` });
      await Promise.resolve();
      expect(fake.endpointAttempts).toHaveLength(2);
      fake.pushPacketFromAttempt(1, { cmd: "DISPATCH", evt: "READY" });
      await expect(secondLogin).resolves.toBeUndefined();
    }
  });

  test("every callback from a dead attempt is inert after reconnect", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });
    await firstLogin;
    fake.errorAttempt(0, new Error("first attempt ended"));

    const secondLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacketFromAttempt(1, { cmd: "DISPATCH", evt: "READY" });
    await secondLogin;

    const update = client.setActivity({ details: "Current connection" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    fake.pushRawFromAttempt(0, new Uint8Array([1, 2, 3, 4]));
    fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });
    fake.closeAttempt(0);
    fake.errorAttempt(0, new Error("late stale error"));
    fake.pushPacketFromAttempt(1, {
      cmd: "SET_ACTIVITY",
      nonce: command.payload.nonce as string,
    });

    await expect(update).resolves.toBeUndefined();
    expect(fake.endpointAttempts).toHaveLength(2);
  });

  test("a socket returned after its attempt terminated is never installed", async () => {
    for (const terminalEvent of ["close", "error"] as const) {
      const fake = createFakeConnector({ terminalBeforeResolve: terminalEvent });
      const client = createDiscordIpcClient({
        connector: fake.connector,
        endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
        timeoutMs: 20,
      });

      await expect(client.login({ clientId: `client-${terminalEvent}` })).rejects.toThrow(
        /Could not connect to Discord IPC/,
      );
      expect(fake.writes).toHaveLength(0);
      expect(fake.ended).toBe(true);
    }
  });

  test("partial bytes from a rejected endpoint cannot complete on the next endpoint", async () => {
    const ready = encodeDiscordIpcPacket(1, { cmd: "DISPATCH", evt: "READY" });
    const fake = createFakeConnector({ firstAttemptDataBeforeReject: ready.subarray(0, 5) });
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0", "/run/user/1000/discord-ipc-1"],
      timeoutMs: 20,
    });
    const login = client.login({ clientId: "client-1" });
    for (let turn = 0; turn < 8 && fake.writes.length === 0; turn += 1) {
      await Promise.resolve();
    }
    expect(fake.endpointAttempts).toHaveLength(2);
    expect(fake.writes).toHaveLength(1);

    fake.pushRawFromAttempt(1, ready.subarray(5));

    await expect(login).rejects.toThrow(/Discord IPC/);
    expect(fake.ended).toBe(true);
  });

  test("destroy aborts a pending endpoint attempt before any fallback can start", async () => {
    const endpointAttempts: string[] = [];
    const writes: Uint8Array[] = [];
    const ended = [0, 0];
    const firstAttempt: { resolve?: (socket: DiscordIpcSocket) => void } = {};
    const sockets: DiscordIpcSocket[] = [0, 1].map((index) => ({
      write(data) {
        writes.push(data);
      },
      end() {
        ended[index] = (ended[index] ?? 0) + 1;
      },
    }));
    const connector: DiscordIpcConnector = async (endpoint) => {
      const attempt = endpointAttempts.length;
      endpointAttempts.push(endpoint);
      if (attempt === 0) {
        return await new Promise<DiscordIpcSocket>((resolve) => {
          firstAttempt.resolve = resolve;
        });
      }
      return sockets[1] as DiscordIpcSocket;
    };
    const client = createDiscordIpcClient({
      connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0", "/run/user/1000/discord-ipc-1"],
      timeoutMs: 20,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    expect(endpointAttempts).toHaveLength(1);

    await client.destroy();
    const resolveFirst = firstAttempt.resolve;
    if (!resolveFirst) throw new Error("first endpoint did not start");
    resolveFirst(sockets[0] as DiscordIpcSocket);

    await expect(login).rejects.toThrow("Discord IPC client was destroyed");
    expect(endpointAttempts).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(ended).toEqual([1, 0]);
  });

  test("a superseded login cannot install or write through the newer login socket", async () => {
    const callbacks: Parameters<DiscordIpcConnector>[1][] = [];
    const writes: Array<{ readonly socket: number; readonly data: Uint8Array }> = [];
    const ended = [0, 0];
    const firstAttempt: { resolve?: (socket: DiscordIpcSocket) => void } = {};
    const sockets: DiscordIpcSocket[] = [0, 1].map((index) => ({
      write(data) {
        writes.push({ socket: index, data });
      },
      end() {
        ended[index] = (ended[index] ?? 0) + 1;
      },
    }));
    const connector: DiscordIpcConnector = async (_endpoint, attemptCallbacks) => {
      const attempt = callbacks.length;
      callbacks.push(attemptCallbacks);
      if (attempt === 0) {
        return await new Promise<DiscordIpcSocket>((resolve) => {
          firstAttempt.resolve = resolve;
        });
      }
      return sockets[1] as DiscordIpcSocket;
    };
    const client = createDiscordIpcClient({
      connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    const secondLogin = client.login({ clientId: "client-1" });
    for (let turn = 0; turn < 8 && writes.length === 0; turn += 1) {
      await Promise.resolve();
    }
    callbacks[1]?.onData(encodeDiscordIpcPacket(1, { cmd: "DISPATCH", evt: "READY" }));
    await expect(secondLogin).resolves.toBeUndefined();
    const resolveFirst = firstAttempt.resolve;
    if (!resolveFirst) throw new Error("first login did not start");

    resolveFirst(sockets[0] as DiscordIpcSocket);

    await expect(firstLogin).rejects.toThrow("Discord IPC login was superseded");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.socket).toBe(1);
    expect(ended).toEqual([1, 0]);

    const update = client.setActivity({ details: "Newer login remains active" });
    const command = decodeDiscordIpcPacket(writes.at(-1)?.data ?? new Uint8Array());
    callbacks[1]?.onData(
      encodeDiscordIpcPacket(1, {
        cmd: "SET_ACTIVITY",
        nonce: command.payload.nonce as string,
      }),
    );
    await expect(update).resolves.toBeUndefined();
  });

  test("reentrant hostile error classification cannot terminalize a newer attempt", async () => {
    const fake = createDistinctSocketConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    for (let turn = 0; turn < 8 && fake.writes.length === 0; turn += 1) {
      await Promise.resolve();
    }
    let secondLogin: Promise<void> | null = null;
    const hostileError = new Proxy(
      {},
      {
        getPrototypeOf() {
          secondLogin ??= client.login({ clientId: "client-1" });
          return Object.prototype;
        },
      },
    );

    expect(() => fake.callbacks[0]?.onError(hostileError)).not.toThrow();
    for (let turn = 0; turn < 8 && !fake.writes.some((write) => write.attempt === 1); turn += 1) {
      await Promise.resolve();
    }
    fake.pushPacket(1, { cmd: "DISPATCH", evt: "READY" });

    await expect(firstLogin).rejects.toThrow("Discord IPC login was superseded");
    await expect(secondLogin).resolves.toBeUndefined();
    expect(fake.ended).toEqual([1, 0]);

    const update = client.setActivity({ details: "New attempt survived hostile error" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1)?.data ?? new Uint8Array());
    fake.pushPacket(1, { cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    await expect(update).resolves.toBeUndefined();
  });

  test("reentrant hostile chunk access cannot contaminate a newer accumulator", async () => {
    const fake = createDistinctSocketConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    for (let turn = 0; turn < 8 && fake.writes.length === 0; turn += 1) {
      await Promise.resolve();
    }
    let secondLogin: Promise<void> | null = null;
    let reentered = false;
    const hostileChunk = new Proxy(new Uint8Array([0]), {
      get(target, property) {
        if (property === "byteLength" && !reentered) {
          reentered = true;
          secondLogin = client.login({ clientId: "client-1" });
        }
        return Reflect.get(target, property, target) as unknown;
      },
    });

    expect(() => fake.callbacks[0]?.onData(hostileChunk)).not.toThrow();
    for (let turn = 0; turn < 8 && !fake.writes.some((write) => write.attempt === 1); turn += 1) {
      await Promise.resolve();
    }
    fake.pushPacket(1, { cmd: "DISPATCH", evt: "READY" });

    await expect(firstLogin).rejects.toThrow("Discord IPC login was superseded");
    await expect(secondLogin).resolves.toBeUndefined();
    expect(fake.ended).toEqual([1, 0]);

    const update = client.setActivity({ details: "New accumulator stayed isolated" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1)?.data ?? new Uint8Array());
    fake.pushPacket(1, { cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    await expect(update).resolves.toBeUndefined();
  });

  test("a synchronous terminal callback during PING stops the rest of its batch", async () => {
    for (const terminalEvent of ["close", "error"] as const) {
      const fake = createFakeConnector({
        terminalOnWrite: { number: 2, event: terminalEvent },
      });
      const client = createDiscordIpcClient({
        connector: fake.connector,
        endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
        timeoutMs: 500,
      });
      const firstLogin = client.login({ clientId: `client-${terminalEvent}` });
      await Promise.resolve();
      const batch = joinBytes(
        encodeDiscordIpcPacket(3, { heartbeat: 1 }),
        encodeDiscordIpcPacket(1, { cmd: "DISPATCH", evt: "READY" }),
      );

      expect(() => fake.pushRawFromAttempt(0, batch)).not.toThrow();
      await expect(firstLogin).rejects.toThrow(/Discord IPC|fake synchronous Discord/);

      const secondLogin = client.login({ clientId: `client-${terminalEvent}` });
      await Promise.resolve();
      expect(fake.endpointAttempts).toHaveLength(2);
      fake.pushPacketFromAttempt(1, { cmd: "DISPATCH", evt: "READY" });
      await expect(secondLogin).resolves.toBeUndefined();
    }
  });

  test("a protocol CLOSE invalidates the generation before a late READY", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });
    await firstLogin;

    const pending = client.setActivity({ details: "Pending" });
    const rejection = pending.then(
      () => null,
      (error) => error as Error,
    );
    expect(() => fake.pushPacketFromAttempt(0, { message: "Discord closed" }, 2)).not.toThrow();
    fake.pushPacketFromAttempt(0, { cmd: "DISPATCH", evt: "READY" });
    expect(await rejection).toEqual(expect.objectContaining({ message: "Discord closed" }));

    const secondLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    expect(fake.endpointAttempts).toHaveLength(2);
    fake.pushPacketFromAttempt(1, { cmd: "DISPATCH", evt: "READY" });
    await expect(secondLogin).resolves.toBeUndefined();
  });

  test("handshake and destroy teardown failures remain contained", async () => {
    const handshakeFake = createFakeConnector({ throwOnWriteNumber: 1, throwOnEnd: true });
    const handshakeClient = createDiscordIpcClient({
      connector: handshakeFake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 20,
    });

    await expect(handshakeClient.login({ clientId: "client-1" })).rejects.toThrow(
      "fake Discord write failed",
    );
    expect(handshakeFake.ended).toBe(true);

    const destroyFake = createFakeConnector({ throwOnEnd: true });
    const destroyClient = createDiscordIpcClient({
      connector: destroyFake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = destroyClient.login({ clientId: "client-1" });
    await Promise.resolve();
    destroyFake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    await expect(destroyClient.destroy()).resolves.toBeUndefined();
    expect(destroyFake.ended).toBe(true);
  });

  test("non-object JSON roots are dropped without breaking the connection", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });

    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY", data: { user: { id: "u" } } });
    await login;

    for (const root of ["null", "[]", '"scalar"', "42", "true"]) {
      expect(() => fake.pushRaw(framedBytes(1, new TextEncoder().encode(root)))).not.toThrow();
    }

    const update = client.setActivity({ details: "Still connected" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    await expect(update).resolves.toBeUndefined();
  });

  test("a frame whose body is not JSON is dropped, not thrown", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });

    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY", data: { user: { id: "u" } } });
    await login;

    expect(() => {
      fake.pushRaw(framedBytes(1, new TextEncoder().encode("{not json")));
    }).not.toThrow();

    // Still usable: the bad frame was skipped, not fatal to the connection.
    const update = client.setActivity({ details: "Watching" });
    const packet = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: packet.payload.nonce as string });
    await update;
  });

  test("a truncated frame is buffered, never thrown", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY", data: { user: { id: "u" } } });
    await login;

    // Header claims 64 bytes; only 4 arrive. Must wait for the rest.
    const header = new Uint8Array(12);
    new DataView(header.buffer).setUint32(4, 64, true);
    expect(() => fake.pushRaw(header)).not.toThrow();
  });

  test("a valid frame at the exact declared-body and retained-buffer boundary is accepted", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    const body = jsonObjectBody(1_048_576);
    const boundaryFrame = framedBytes(1, body);
    expect(body.byteLength).toBe(1_048_576);
    expect(boundaryFrame.byteLength).toBe(1_048_584);
    expect(() => fake.pushRaw(boundaryFrame)).not.toThrow();
    expect(fake.ended).toBe(false);

    const update = client.setActivity({ details: "Boundary accepted" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    await expect(update).resolves.toBeUndefined();
  });

  test("a chunk above the retained-buffer cap is accepted when it contains only complete frames", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    const body = jsonObjectBody(525_000);
    const coalesced = joinBytes(framedBytes(1, body), framedBytes(1, body));
    expect(coalesced.byteLength).toBe(1_050_016);
    expect(() => fake.pushRaw(coalesced)).not.toThrow();
    expect(fake.ended).toBe(false);

    const update = client.setActivity({ details: "Coalesced frames accepted" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    await expect(update).resolves.toBeUndefined();
  });

  test("an oversized frame length drops the connection instead of buffering", async () => {
    const fake = createFakeConnector({ throwOnEnd: true });
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY", data: { user: { id: "u" } } });
    await login;

    const pending = client.setActivity({ details: "Pending" });
    const rejection = pending.then(
      () => null,
      (error) => error as Error,
    );

    // A 32-bit length field can claim 4 GiB. Waiting for it would grow the
    // accumulator without bound.
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(4, MAX_DISCORD_IPC_FRAME_BYTES + 1, true);

    expect(() => fake.pushRaw(header)).not.toThrow();
    expect(fake.ended).toBe(true);
    expect(await rejection).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/Discord IPC protocol/i) }),
    );
  });

  test("complete frames above the cap can retain and later complete a small suffix", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY", data: { user: { id: "u" } } });
    await login;

    const pending = client.setActivity({ details: "Pending" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    const reply = encodeDiscordIpcPacket(1, {
      cmd: "SET_ACTIVITY",
      nonce: command.payload.nonce as string,
    });
    const body = jsonObjectBody(525_000);
    const withSuffix = joinBytes(framedBytes(1, body), framedBytes(1, body), reply.subarray(0, 1));
    expect(withSuffix.byteLength).toBe(1_050_017);

    expect(() => fake.pushRaw(withSuffix)).not.toThrow();
    expect(fake.ended).toBe(false);
    fake.pushRaw(reply.subarray(1));
    await expect(pending).resolves.toBeUndefined();
  });

  test("a declared-body violation wins when total input also exceeds the buffer cap", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    const pending = client.setActivity({ details: "Pending" });
    const rejection = pending.then(
      () => null,
      (error) => error as Error,
    );
    const dualViolation = new Uint8Array(MAX_DISCORD_IPC_BUFFER_BYTES + 1);
    new DataView(dualViolation.buffer).setUint32(4, MAX_DISCORD_IPC_FRAME_BYTES + 1, true);

    expect(() => fake.pushRaw(dualViolation)).not.toThrow();
    expect(fake.ended).toBe(true);
    expect(await rejection).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/declared-frame-too-large/) }),
    );
  });

  test("a framing fault clears state so the same client can reconnect", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const firstLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await firstLogin;

    const oversized = new Uint8Array(8);
    new DataView(oversized.buffer).setUint32(4, MAX_DISCORD_IPC_FRAME_BYTES + 1, true);
    fake.pushRaw(oversized);

    const secondLogin = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await expect(secondLogin).resolves.toBeUndefined();
    expect(fake.endpointAttempts).toHaveLength(2);

    const update = client.setActivity({ details: "Reconnected" });
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: command.payload.nonce as string });
    await expect(update).resolves.toBeUndefined();
  });

  test("one frame can be split at every byte boundary", async () => {
    const body = new TextEncoder().encode('{"cmd":"DISPATCH","evt":"READY"}');
    const readyFrame = framedBytes(1, body);

    for (let split = 1; split < readyFrame.byteLength; split += 1) {
      const fake = createFakeConnector();
      const client = createDiscordIpcClient({
        connector: fake.connector,
        endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
        timeoutMs: 500,
      });
      const login = client.login({ clientId: `client-${split}` });
      await Promise.resolve();

      fake.pushRaw(readyFrame.slice(0, split));
      fake.pushRaw(readyFrame.slice(split));

      await expect(login).resolves.toBeUndefined();
      await client.destroy();
    }
  });

  test("three coalesced frames resolve their matching pending commands", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    const updates = ["One", "Two", "Three"].map((details) => client.setActivity({ details }));
    const commands = fake.writes.slice(-3).map((write) => decodeDiscordIpcPacket(write));
    const replies = commands.map((command) =>
      encodeDiscordIpcPacket(1, {
        cmd: "SET_ACTIVITY",
        nonce: command.payload.nonce as string,
      }),
    );

    fake.pushRaw(joinBytes(...replies));

    await expect(Promise.all(updates)).resolves.toEqual([undefined, undefined, undefined]);
  });

  test("a framing fault rejects pending commands before accepting packets from the same batch", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
    });
    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY" });
    await login;

    const pending = client.setActivity({ details: "Pending" });
    const rejection = pending.then(
      () => null,
      (error) => error as Error,
    );
    const command = decodeDiscordIpcPacket(fake.writes.at(-1) ?? new Uint8Array());
    const reply = encodeDiscordIpcPacket(1, {
      cmd: "SET_ACTIVITY",
      nonce: command.payload.nonce as string,
    });
    const oversized = new Uint8Array(8);
    new DataView(oversized.buffer).setUint32(4, MAX_DISCORD_IPC_FRAME_BYTES + 1, true);

    fake.pushRaw(joinBytes(reply, oversized));

    expect(fake.ended).toBe(true);
    expect(await rejection).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/Discord IPC protocol/i) }),
    );
  });

  test("tryDecodeDiscordIpcPacket returns null where decode throws", () => {
    const badJson = framedBytes(1, new TextEncoder().encode("{"));
    expect(() => decodeDiscordIpcPacket(badJson)).toThrow();
    expect(tryDecodeDiscordIpcPacket(badJson)).toBeNull();

    // Short header and truncated body throw in the strict decoder too.
    expect(tryDecodeDiscordIpcPacket(new Uint8Array(4))).toBeNull();

    for (const root of ["null", "[]", '"scalar"', "42", "true"]) {
      const nonObject = framedBytes(1, new TextEncoder().encode(root));
      expect(() => decodeDiscordIpcPacket(nonObject)).toThrow(/payload root/i);
      expect(tryDecodeDiscordIpcPacket(nonObject)).toBeNull();
    }

    // A well-formed frame still decodes.
    expect(tryDecodeDiscordIpcPacket(encodeDiscordIpcPacket(1, { cmd: "PING" }))).toEqual({
      op: 1,
      payload: { cmd: "PING" },
    });
  });
});

describe("discord-ipc-client", () => {
  test("encodes and decodes Discord local IPC packets", () => {
    const encoded = encodeDiscordIpcPacket(1, { cmd: "PING", nonce: "n1" });

    expect(decodeDiscordIpcPacket(encoded)).toEqual({
      op: 1,
      payload: { cmd: "PING", nonce: "n1" },
    });
  });

  test("connects with a Bun-native handshake and sends activity frames", async () => {
    const fake = createFakeConnector();
    const client = createDiscordIpcClient({
      connector: fake.connector,
      endpointCandidates: () => ["/run/user/1000/discord-ipc-0"],
      timeoutMs: 500,
      pid: 1234,
    });

    const login = client.login({ clientId: "client-1" });
    await Promise.resolve();
    fake.pushPacket({ cmd: "DISPATCH", evt: "READY", data: { user: { id: "discord-user" } } });
    await login;

    expect(fake.endpointAttempts).toEqual(["/run/user/1000/discord-ipc-0"]);
    expect(decodeDiscordIpcPacket(fake.writes[0] ?? new Uint8Array())).toEqual({
      op: 0,
      payload: { v: 1, client_id: "client-1" },
    });

    const update = client.setActivity({
      details: "Watching",
      state: "S1 E1",
      timestamps: { start: 1_700_000_000, end: 1_700_001_500 },
      assets: { large_image: "kunai", large_text: "Kunai" },
    });
    const updatePacket = decodeDiscordIpcPacket(fake.writes[1] ?? new Uint8Array());
    expect(updatePacket.op).toBe(1);
    expect(updatePacket.payload).toMatchObject({
      cmd: "SET_ACTIVITY",
      args: {
        pid: 1234,
        activity: {
          details: "Watching",
          state: "S1 E1",
          timestamps: { start: 1_700_000_000, end: 1_700_001_500 },
          assets: { large_image: "kunai", large_text: "Kunai" },
        },
      },
    });
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: updatePacket.payload.nonce as string });
    await update;

    const clear = client.clearActivity();
    const clearPacket = decodeDiscordIpcPacket(fake.writes[2] ?? new Uint8Array());
    expect(clearPacket.payload).toMatchObject({
      cmd: "SET_ACTIVITY",
      args: { pid: 1234, activity: null },
    });
    fake.pushPacket({ cmd: "SET_ACTIVITY", nonce: clearPacket.payload.nonce as string });
    await clear;
  });

  test("tries each endpoint candidate before reporting Discord unavailable", async () => {
    const endpointAttempts: string[] = [];
    const connector: DiscordIpcConnector = async (endpoint) => {
      endpointAttempts.push(endpoint);
      throw new Error(`missing ${endpoint}`);
    };
    const client = createDiscordIpcClient({
      connector,
      endpointCandidates: () => ["/tmp/discord-ipc-0", "/tmp/discord-ipc-1"],
      timeoutMs: 10,
    });

    await expect(client.login({ clientId: "client-1" })).rejects.toThrow(
      "Could not connect to Discord IPC",
    );
    expect(endpointAttempts).toEqual(["/tmp/discord-ipc-0", "/tmp/discord-ipc-1"]);
  });

  test("uses platform-specific Discord IPC endpoint candidates", () => {
    expect(
      resolveDiscordIpcEndpointCandidates({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: "/run/user/1000" },
      })[0],
    ).toBe("/run/user/1000/discord-ipc-0");
    expect(resolveDiscordIpcEndpointCandidates({ platform: "win32", env: {} })[0]).toBe(
      "\\\\.\\pipe\\discord-ipc-0",
    );
  });
});
