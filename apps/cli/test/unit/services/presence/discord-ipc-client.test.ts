import { describe, expect, test } from "bun:test";

import {
  createDiscordIpcClient,
  decodeDiscordIpcPacket,
  encodeDiscordIpcPacket,
  resolveDiscordIpcEndpointCandidates,
  type DiscordIpcConnector,
  type DiscordIpcSocket,
} from "@/services/presence/discord-ipc-client";

function createFakeConnector(): {
  connector: DiscordIpcConnector;
  writes: Uint8Array[];
  endpointAttempts: string[];
  pushPacket(packet: Record<string, unknown>, op?: number): void;
  close(): void;
} {
  const writes: Uint8Array[] = [];
  const endpointAttempts: string[] = [];
  let activeCallbacks: Parameters<DiscordIpcConnector>[1] | null = null;

  const socket: DiscordIpcSocket = {
    write(data) {
      writes.push(data);
    },
    end() {
      activeCallbacks?.onClose();
    },
  };

  return {
    writes,
    endpointAttempts,
    connector: async (endpoint, callbacks) => {
      endpointAttempts.push(endpoint);
      activeCallbacks = callbacks;
      return socket;
    },
    pushPacket(packet, op = 1) {
      activeCallbacks?.onData(encodeDiscordIpcPacket(op, packet));
    },
    close() {
      activeCallbacks?.onClose();
    },
  };
}

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

    const update = client.setActivity({ details: "Watching", state: "S1 E1" });
    const updatePacket = decodeDiscordIpcPacket(fake.writes[1] ?? new Uint8Array());
    expect(updatePacket.op).toBe(1);
    expect(updatePacket.payload).toMatchObject({
      cmd: "SET_ACTIVITY",
      args: { pid: 1234, activity: { details: "Watching", state: "S1 E1" } },
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
