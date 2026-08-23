import { describe, expect, test } from "bun:test";

import {
  createDiscordIpcClient,
  decodeDiscordIpcPacket,
  encodeDiscordIpcPacket,
  resolveDiscordIpcEndpointCandidates,
  tryDecodeDiscordIpcPacket,
  MAX_DISCORD_IPC_FRAME_BYTES,
  type DiscordIpcConnector,
  type DiscordIpcSocket,
} from "@/services/presence/discord-ipc-client";

function createFakeConnector(): {
  connector: DiscordIpcConnector;
  writes: Uint8Array[];
  endpointAttempts: string[];
  ended: boolean;
  pushPacket(packet: Record<string, unknown>, op?: number): void;
  pushRaw(data: Uint8Array): void;
  close(): void;
} {
  const writes: Uint8Array[] = [];
  const endpointAttempts: string[] = [];
  let activeCallbacks: Parameters<DiscordIpcConnector>[1] | null = null;

  const state = {
    writes,
    endpointAttempts,
    ended: false,
    connector: (async (endpoint, callbacks) => {
      endpointAttempts.push(endpoint);
      activeCallbacks = callbacks;
      return socket;
    }) as DiscordIpcConnector,
    pushPacket(packet: Record<string, unknown>, op = 1) {
      activeCallbacks?.onData(encodeDiscordIpcPacket(op, packet));
    },
    /** Bytes exactly as given — for frames `encodeDiscordIpcPacket` cannot produce. */
    pushRaw(data: Uint8Array) {
      activeCallbacks?.onData(data);
    },
    close() {
      activeCallbacks?.onClose();
    },
  };

  const socket: DiscordIpcSocket = {
    write(data) {
      writes.push(data);
    },
    end() {
      state.ended = true;
      activeCallbacks?.onClose();
    },
  };

  return state;
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

/**
 * Presence is best-effort and optional. A throw inside the `Bun.connect` data
 * callback is an uncaught exception, not a rejected promise, and `main.ts`
 * escalates those to a fatal shutdown — so anything reaching it from here ends
 * the user's playback session. These pin that it cannot.
 */
describe("discord-ipc-client malformed input containment", () => {
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

  test("an oversized frame length drops the connection instead of buffering", async () => {
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

    // A 32-bit length field can claim 4 GiB. Waiting for it would grow the
    // accumulator without bound.
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(4, MAX_DISCORD_IPC_FRAME_BYTES + 1, true);

    expect(() => fake.pushRaw(header)).not.toThrow();
    expect(fake.ended).toBe(true);
  });

  test("tryDecodeDiscordIpcPacket returns null where decode throws", () => {
    const badJson = framedBytes(1, new TextEncoder().encode("{"));
    expect(() => decodeDiscordIpcPacket(badJson)).toThrow();
    expect(tryDecodeDiscordIpcPacket(badJson)).toBeNull();

    // Short header and truncated body throw in the strict decoder too.
    expect(tryDecodeDiscordIpcPacket(new Uint8Array(4))).toBeNull();

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
