const DISCORD_IPC_VERSION = 1;
const DEFAULT_DISCORD_IPC_TIMEOUT_MS = 10_000;

export type DiscordIpcSocket = {
  write(data: Uint8Array): void;
  end(): void;
};

export type DiscordIpcConnector = (
  endpoint: string,
  callbacks: {
    readonly onData: (data: Uint8Array) => void;
    readonly onClose: () => void;
    readonly onError: (error: unknown) => void;
  },
) => Promise<DiscordIpcSocket>;

export type DiscordPresenceClient = {
  login(input: { clientId: string }): Promise<void>;
  setActivity(activity: Record<string, unknown>): Promise<void>;
  clearActivity(): Promise<void>;
  destroy(): Promise<void>;
  on(event: "ready", callback: () => void): void;
};

type PendingFrame = {
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
};

type DiscordIpcFrame = {
  readonly op: number;
  readonly payload: Record<string, unknown>;
};

export function resolveDiscordIpcEndpointCandidates(input: {
  readonly platform?: NodeJS.Platform;
  readonly env?: Record<string, string | undefined>;
}): readonly string[] {
  const platform = input.platform ?? process.platform;
  if (platform === "win32") {
    return Array.from({ length: 10 }, (_, index) => `\\\\.\\pipe\\discord-ipc-${index}`);
  }

  const env = input.env ?? Bun.env;
  const baseDir =
    env.XDG_RUNTIME_DIR?.trim() ||
    env.TMPDIR?.trim() ||
    env.TMP?.trim() ||
    env.TEMP?.trim() ||
    "/tmp";
  const normalizedBase = baseDir.replace(/\/+$/, "");
  return Array.from({ length: 10 }, (_, index) => `${normalizedBase}/discord-ipc-${index}`);
}

export function encodeDiscordIpcPacket(op: number, payload: Record<string, unknown>): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const packet = new Uint8Array(8 + body.byteLength);
  const view = new DataView(packet.buffer);
  view.setUint32(0, op, true);
  view.setUint32(4, body.byteLength, true);
  packet.set(body, 8);
  return packet;
}

export function decodeDiscordIpcPacket(data: Uint8Array): DiscordIpcFrame {
  if (data.byteLength < 8) {
    throw new Error("Discord IPC frame was shorter than its header");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const op = view.getUint32(0, true);
  const length = view.getUint32(4, true);
  if (data.byteLength < 8 + length) {
    throw new Error("Discord IPC frame body was incomplete");
  }
  const body = data.slice(8, 8 + length);
  const payload = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  return { op, payload };
}

export function createDiscordIpcClient(
  options: {
    readonly connector?: DiscordIpcConnector;
    readonly endpointCandidates?: () => readonly string[];
    readonly timeoutMs?: number;
    readonly pid?: number;
  } = {},
): DiscordPresenceClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCORD_IPC_TIMEOUT_MS;
  const pid = options.pid ?? process.pid;
  const connector = options.connector ?? bunDiscordIpcConnector;
  const endpointCandidates =
    options.endpointCandidates ?? (() => resolveDiscordIpcEndpointCandidates({}));

  let socket: DiscordIpcSocket | null = null;
  let buffer = new Uint8Array(0);
  let ready = false;
  let destroyed = false;
  let nonceCounter = 0;
  let readyResolver: (() => void) | null = null;
  let readyRejecter: ((error: Error) => void) | null = null;
  const readyCallbacks = new Set<() => void>();
  const pending = new Map<string, PendingFrame>();

  const rejectAll = (error: Error) => {
    readyRejecter?.(error);
    readyResolver = null;
    readyRejecter = null;
    for (const [nonce, frame] of pending) {
      clearTimeout(frame.timeout);
      frame.reject(error);
      pending.delete(nonce);
    }
  };

  const handlePayload = (op: number, payload: Record<string, unknown>) => {
    if (op === 3) {
      socket?.write(encodeDiscordIpcPacket(4, payload));
      return;
    }
    if (op === 2) {
      rejectAll(new Error(describeDiscordErrorPayload(payload) ?? "Discord IPC closed"));
      return;
    }
    if (op !== 1) return;

    const nonce = typeof payload.nonce === "string" ? payload.nonce : null;
    if (payload.evt === "READY") {
      ready = true;
      readyResolver?.();
      readyResolver = null;
      readyRejecter = null;
      for (const callback of readyCallbacks) callback();
      return;
    }
    if (!nonce) return;
    const frame = pending.get(nonce);
    if (!frame) return;
    pending.delete(nonce);
    clearTimeout(frame.timeout);
    if (payload.evt === "ERROR") {
      frame.reject(new Error(describeDiscordErrorPayload(payload) ?? "Discord IPC command failed"));
    } else {
      frame.resolve();
    }
  };

  const handleData = (chunk: Uint8Array) => {
    const next = new Uint8Array(buffer.byteLength + chunk.byteLength);
    next.set(buffer, 0);
    next.set(chunk, buffer.byteLength);
    buffer = next;

    while (buffer.byteLength >= 8) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const length = view.getUint32(4, true);
      const frameLength = 8 + length;
      if (buffer.byteLength < frameLength) return;
      const packet = buffer.slice(0, frameLength);
      buffer = buffer.slice(frameLength);
      const frame = decodeDiscordIpcPacket(packet);
      handlePayload(frame.op, frame.payload);
    }
  };

  const sendFrame = (payload: Record<string, unknown>): Promise<void> => {
    if (!socket || !ready) return Promise.reject(new Error("Discord IPC is not connected"));
    const nonce = `kunai-${Date.now().toString(36)}-${++nonceCounter}`;
    const frame = { ...payload, nonce };
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(nonce);
        reject(new Error("Discord IPC command timed out"));
      }, timeoutMs);
      pending.set(nonce, { timeout, resolve, reject });
      socket?.write(encodeDiscordIpcPacket(1, frame));
    });
  };

  return {
    async login(input) {
      if (ready) return;
      if (destroyed) throw new Error("Discord IPC client was destroyed");

      let lastError: unknown = null;
      for (const endpoint of endpointCandidates()) {
        try {
          socket = await connector(endpoint, {
            onData: handleData,
            onClose: () => rejectAll(new Error("Discord IPC connection closed")),
            onError: (error) => rejectAll(toError(error)),
          });
          break;
        } catch (error) {
          lastError = error;
          socket = null;
        }
      }
      if (!socket) {
        throw new Error(
          `Could not connect to Discord IPC${lastError ? `: ${normalizeErrorMessage(lastError)}` : ""}`,
        );
      }

      const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          readyResolver = null;
          readyRejecter = null;
          reject(new Error("Discord IPC ready timed out"));
        }, timeoutMs);
        readyResolver = () => {
          clearTimeout(timeout);
          resolve();
        };
        readyRejecter = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });
      socket.write(
        encodeDiscordIpcPacket(0, {
          v: DISCORD_IPC_VERSION,
          client_id: input.clientId,
        }),
      );
      try {
        await readyPromise;
      } catch (error) {
        socket?.end();
        socket = null;
        throw error;
      }
    },
    setActivity(activity) {
      return sendFrame({
        cmd: "SET_ACTIVITY",
        args: { pid, activity },
      });
    },
    clearActivity() {
      return sendFrame({
        cmd: "SET_ACTIVITY",
        args: { pid, activity: null },
      });
    },
    async destroy() {
      destroyed = true;
      ready = false;
      rejectAll(new Error("Discord IPC client destroyed"));
      if (socket) {
        try {
          socket.write(encodeDiscordIpcPacket(2, {}));
        } catch {
          // Ignore close-frame failures; socket teardown is best effort.
        }
        socket.end();
        socket = null;
      }
    },
    on(event, callback) {
      if (event !== "ready") return;
      readyCallbacks.add(callback);
      if (ready) callback();
    },
  };
}

async function bunDiscordIpcConnector(
  endpoint: string,
  callbacks: Parameters<DiscordIpcConnector>[1],
): Promise<DiscordIpcSocket> {
  const socket = await Bun.connect({
    unix: endpoint,
    socket: {
      open() {},
      data(_socket, data) {
        callbacks.onData(data);
      },
      close() {
        callbacks.onClose();
      },
      error(_socket, error) {
        callbacks.onError(error);
      },
    },
  });
  return {
    write(data) {
      socket.write(data);
    },
    end() {
      socket.end();
    },
  };
}

function describeDiscordErrorPayload(payload: Record<string, unknown>): string | null {
  const data = typeof payload.data === "object" && payload.data ? payload.data : payload;
  const record = data as Record<string, unknown>;
  const message =
    typeof record.message === "string"
      ? record.message
      : typeof payload.message === "string"
        ? payload.message
        : null;
  const code =
    typeof record.code === "number" || typeof record.code === "string" ? record.code : null;
  return [code ? `Discord ${code}` : null, message].filter(Boolean).join(": ") || null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(normalizeErrorMessage(error));
}

function normalizeErrorMessage(error: unknown): string {
  const raw = String(error).trim();
  return raw.startsWith("Error: ") ? raw.slice("Error: ".length) : raw;
}
