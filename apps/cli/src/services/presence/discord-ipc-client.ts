import { dbg } from "@/logger";

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

export type DiscordIpcProtocolFault = {
  readonly reason:
    | "invalid-json"
    | "invalid-payload-root"
    | "declared-frame-too-large"
    | "buffer-limit-exceeded";
  readonly opcode?: number;
  readonly declaredBytes?: number;
  readonly bufferedBytes: number;
};

type DiscordIpcFrameBatch = {
  readonly packets: readonly Uint8Array[];
  readonly fault?: DiscordIpcProtocolFault;
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

/**
 * Largest Discord IPC frame we will buffer.
 *
 * Frames are small JSON control messages; the header's 32-bit length field can
 * claim up to 4 GiB. Without a ceiling a desynced or hostile stream declares a
 * huge frame and `handleData` grows its accumulator until the memory watchdog
 * kills the process, which is a long way to travel for a rich-presence update.
 */
export const MAX_DISCORD_IPC_FRAME_BYTES = 1_048_576;
export const MAX_DISCORD_IPC_BUFFER_BYTES = 1_048_584;

class DiscordIpcFrameAccumulator {
  private chunks: Array<Uint8Array | undefined> = [];
  private headChunk = 0;
  private headOffset = 0;
  private bufferedBytes = 0;

  push(chunk: Uint8Array): DiscordIpcFrameBatch {
    if (chunk.byteLength > 0) {
      this.chunks.push(chunk);
      this.bufferedBytes += chunk.byteLength;
    }

    const packets: Uint8Array[] = [];
    while (this.bufferedBytes >= 8) {
      const opcode = this.peekUint32(0);
      const declaredBytes = this.peekUint32(4);
      if (declaredBytes > MAX_DISCORD_IPC_FRAME_BYTES) {
        const fault: DiscordIpcProtocolFault = {
          reason: "declared-frame-too-large",
          opcode,
          declaredBytes,
          bufferedBytes: this.bufferedBytes,
        };
        this.clear();
        return { packets, fault };
      }

      const frameBytes = 8 + declaredBytes;
      if (this.bufferedBytes < frameBytes) break;

      const packet = new Uint8Array(frameBytes);
      this.copyFromHead(packet);
      this.consume(frameBytes);
      packets.push(packet);
    }

    if (this.bufferedBytes > MAX_DISCORD_IPC_BUFFER_BYTES) {
      const fault: DiscordIpcProtocolFault = {
        reason: "buffer-limit-exceeded",
        bufferedBytes: this.bufferedBytes,
      };
      this.clear();
      return { packets, fault };
    }
    if (chunk.byteLength > MAX_DISCORD_IPC_BUFFER_BYTES && this.bufferedBytes > 0) {
      this.detachRetainedSuffix();
    }

    return { packets };
  }

  clear(): void {
    this.chunks = [];
    this.headChunk = 0;
    this.headOffset = 0;
    this.bufferedBytes = 0;
  }

  private peekUint32(relativeOffset: number): number {
    let value = 0;
    for (let index = 0; index < 4; index += 1) {
      value |= this.byteAt(relativeOffset + index) << (index * 8);
    }
    return value >>> 0;
  }

  private byteAt(relativeOffset: number): number {
    let chunkIndex = this.headChunk;
    let offset = this.headOffset + relativeOffset;
    while (chunkIndex < this.chunks.length) {
      const chunk = this.chunks[chunkIndex];
      if (!chunk) break;
      if (offset < chunk.byteLength) return chunk[offset] ?? 0;
      offset -= chunk.byteLength;
      chunkIndex += 1;
    }
    throw new Error("Discord IPC accumulator read beyond buffered data");
  }

  private copyFromHead(target: Uint8Array): void {
    let targetOffset = 0;
    let chunkIndex = this.headChunk;
    let chunkOffset = this.headOffset;
    while (targetOffset < target.byteLength) {
      const chunk = this.chunks[chunkIndex];
      if (!chunk) throw new Error("Discord IPC accumulator lost buffered data");
      const copyBytes = Math.min(chunk.byteLength - chunkOffset, target.byteLength - targetOffset);
      target.set(chunk.subarray(chunkOffset, chunkOffset + copyBytes), targetOffset);
      targetOffset += copyBytes;
      chunkIndex += 1;
      chunkOffset = 0;
    }
  }

  private detachRetainedSuffix(): void {
    const retained = new Uint8Array(this.bufferedBytes);
    this.copyFromHead(retained);
    this.clear();
    this.chunks.push(retained);
    this.bufferedBytes = retained.byteLength;
  }

  private consume(bytes: number): void {
    let remaining = bytes;
    while (remaining > 0) {
      const chunk = this.chunks[this.headChunk];
      if (!chunk) throw new Error("Discord IPC accumulator lost buffered data");
      const available = chunk.byteLength - this.headOffset;
      if (remaining < available) {
        this.headOffset += remaining;
        remaining = 0;
      } else {
        remaining -= available;
        this.chunks[this.headChunk] = undefined;
        this.headChunk += 1;
        this.headOffset = 0;
      }
    }
    this.bufferedBytes -= bytes;

    if (this.bufferedBytes === 0) {
      this.clear();
    } else if (this.headChunk >= 64 && this.headChunk * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.headChunk);
      this.headChunk = 0;
    }
  }
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
  const payload: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!isDiscordIpcPayload(payload)) {
    throw new Error("Discord IPC payload root was not an object");
  }
  return { op, payload };
}

/**
 * Decode without throwing, for the socket data callback.
 *
 * `decodeDiscordIpcPacket` runs `JSON.parse` on bytes Discord sent us. A throw
 * inside a `Bun.connect` data callback is not a rejected promise — it is an
 * uncaught exception, and `main.ts` escalates those to a *fatal* shutdown. That
 * put a malformed frame from an optional, cosmetic integration on the path that
 * ends the user's playback session. Presence is best-effort: a frame we cannot
 * read is dropped, not fatal. Mirrors `parseMpvIpcLine`, which returns null for
 * the same reason.
 */
export function tryDecodeDiscordIpcPacket(data: Uint8Array): DiscordIpcFrame | null {
  try {
    return decodeDiscordIpcPacket(data);
  } catch {
    return null;
  }
}

function decodeDiscordIpcSocketPacket(data: Uint8Array): {
  readonly frame: DiscordIpcFrame | null;
  readonly fault?: DiscordIpcProtocolFault;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const op = view.getUint32(0, true);
  const declaredBytes = view.getUint32(4, true);
  const body = data.subarray(8, 8 + declaredBytes);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return {
      frame: null,
      fault: {
        reason: "invalid-json",
        opcode: op,
        declaredBytes,
        bufferedBytes: data.byteLength,
      },
    };
  }
  if (!isDiscordIpcPayload(payload)) {
    return {
      frame: null,
      fault: {
        reason: "invalid-payload-root",
        opcode: op,
        declaredBytes,
        bufferedBytes: data.byteLength,
      },
    };
  }
  return { frame: { op, payload } };
}

type DiscordIpcConnectionAttempt = {
  readonly loginGeneration: number;
  readonly accumulator: DiscordIpcFrameAccumulator;
  socket: DiscordIpcSocket | null;
  terminalCause: Error | null;
  ready: boolean;
  readyResolver: (() => void) | null;
  readyRejecter: ((error: Error) => void) | null;
};

export function createDiscordIpcClient(
  options: {
    readonly connector?: DiscordIpcConnector;
    readonly endpointCandidates?: () => readonly string[];
    readonly timeoutMs?: number;
    readonly pid?: number;
    readonly onProtocolFault?: (fault: DiscordIpcProtocolFault) => void;
  } = {},
): DiscordPresenceClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCORD_IPC_TIMEOUT_MS;
  const pid = options.pid ?? process.pid;
  const connector = options.connector ?? bunDiscordIpcConnector;
  const endpointCandidates =
    options.endpointCandidates ?? (() => resolveDiscordIpcEndpointCandidates({}));
  const onProtocolFault =
    options.onProtocolFault ??
    ((fault: DiscordIpcProtocolFault) => {
      dbg("presence.discord-ipc", "Discord IPC protocol fault", { ...fault });
    });

  let activeAttempt: DiscordIpcConnectionAttempt | null = null;
  let destroyed = false;
  let loginGeneration = 0;
  let nonceCounter = 0;
  const readyCallbacks = new Set<() => void>();
  const pending = new Map<string, PendingFrame>();

  const rejectAll = (error: Error) => {
    for (const [nonce, frame] of pending) {
      clearTimeout(frame.timeout);
      frame.reject(error);
      pending.delete(nonce);
    }
  };

  const endSocketBestEffort = (target: DiscordIpcSocket | null) => {
    if (!target) return;
    try {
      target.end();
    } catch {
      // Discord teardown is best effort and must stay inside the optional integration.
    }
  };

  const isActiveAttempt = (attempt: DiscordIpcConnectionAttempt) => activeAttempt === attempt;

  const terminalizeAttempt = (
    attempt: DiscordIpcConnectionAttempt,
    error: Error,
    endSocket: boolean,
  ): Error => {
    const cause = attempt.terminalCause ?? error;
    const terminalSocket = attempt.socket;
    const wasActive = isActiveAttempt(attempt);
    attempt.terminalCause = cause;
    attempt.socket = null;
    attempt.ready = false;
    attempt.accumulator.clear();
    attempt.readyRejecter?.(cause);
    attempt.readyResolver = null;
    attempt.readyRejecter = null;
    if (wasActive) {
      activeAttempt = null;
      rejectAll(cause);
    }
    if (endSocket) endSocketBestEffort(terminalSocket);
    return cause;
  };

  const currentLoginError = () =>
    new Error(destroyed ? "Discord IPC client was destroyed" : "Discord IPC login was superseded");

  const notifyReadyBestEffort = (callback: () => void) => {
    try {
      callback();
    } catch {
      // Presence observers cannot affect the optional transport.
    }
  };

  const reportProtocolFaultBestEffort = (fault: DiscordIpcProtocolFault) => {
    try {
      onProtocolFault({ ...fault });
    } catch {
      // Protocol diagnostics cannot affect the optional transport.
    }
  };

  const handlePayload = (
    attempt: DiscordIpcConnectionAttempt,
    op: number,
    payload: Record<string, unknown>,
  ) => {
    if (!isActiveAttempt(attempt)) return;
    if (op === 2) {
      terminalizeAttempt(
        attempt,
        new Error(describeDiscordErrorPayload(payload) ?? "Discord IPC closed"),
        true,
      );
      return;
    }
    if (op !== 1) return;

    const nonce = typeof payload.nonce === "string" ? payload.nonce : null;
    if (payload.evt === "READY") {
      attempt.ready = true;
      attempt.readyResolver?.();
      attempt.readyResolver = null;
      attempt.readyRejecter = null;
      for (const callback of readyCallbacks) {
        notifyReadyBestEffort(callback);
        if (!isActiveAttempt(attempt)) return;
      }
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

  const handleFramingFault = (
    attempt: DiscordIpcConnectionAttempt,
    fault: DiscordIpcProtocolFault,
  ) => {
    terminalizeAttempt(attempt, new Error(`Discord IPC protocol fault: ${fault.reason}`), true);
  };

  const handleData = (attempt: DiscordIpcConnectionAttempt, chunk: Uint8Array) => {
    const batch = attempt.accumulator.push(chunk);
    if (!isActiveAttempt(attempt)) {
      attempt.accumulator.clear();
      return;
    }
    if (batch.fault) {
      reportProtocolFaultBestEffort(batch.fault);
      if (!isActiveAttempt(attempt)) return;
      handleFramingFault(attempt, batch.fault);
      return;
    }
    for (const packet of batch.packets) {
      if (!isActiveAttempt(attempt)) return;
      const decoded = decodeDiscordIpcSocketPacket(packet);
      if (!isActiveAttempt(attempt)) return;
      if (decoded.fault) {
        reportProtocolFaultBestEffort(decoded.fault);
        if (!isActiveAttempt(attempt)) return;
        continue;
      }
      if (!decoded.frame) continue;
      if (decoded.frame.op === 3) {
        new DataView(packet.buffer, packet.byteOffset, packet.byteLength).setUint32(0, 4, true);
        const targetSocket = attempt.socket;
        if (!targetSocket) {
          terminalizeAttempt(attempt, new Error("Discord IPC socket was unavailable"), true);
          return;
        }
        targetSocket.write(packet);
        if (!isActiveAttempt(attempt) || attempt.socket !== targetSocket) return;
        continue;
      }
      handlePayload(attempt, decoded.frame.op, decoded.frame.payload);
    }
  };

  const handleDataSafely = (attempt: DiscordIpcConnectionAttempt, chunk: Uint8Array) => {
    try {
      handleData(attempt, chunk);
    } catch {
      terminalizeAttempt(attempt, new Error("Discord IPC callback failed"), true);
    }
  };

  const sendFrame = (payload: Record<string, unknown>): Promise<void> => {
    const attempt = activeAttempt;
    const targetSocket = attempt?.socket ?? null;
    if (!attempt || !targetSocket || !attempt.ready || attempt.terminalCause) {
      return Promise.reject(new Error("Discord IPC is not connected"));
    }
    const nonce = `kunai-${Date.now().toString(36)}-${++nonceCounter}`;
    const frame = { ...payload, nonce };
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(nonce);
        reject(new Error("Discord IPC command timed out"));
      }, timeoutMs);
      pending.set(nonce, { timeout, resolve, reject });
      try {
        targetSocket.write(encodeDiscordIpcPacket(1, frame));
      } catch (error) {
        terminalizeAttempt(attempt, toError(error), true);
      }
    });
  };

  return {
    async login(input) {
      if (destroyed) throw new Error("Discord IPC client was destroyed");
      const readyAttempt = activeAttempt;
      const readySocket = readyAttempt?.socket ?? null;
      if (
        readyAttempt?.ready &&
        readySocket &&
        !readyAttempt.terminalCause &&
        isActiveAttempt(readyAttempt)
      ) {
        await Promise.resolve();
        if (destroyed) throw new Error("Discord IPC client was destroyed");
        if (
          isActiveAttempt(readyAttempt) &&
          readyAttempt.socket === readySocket &&
          readyAttempt.ready &&
          !readyAttempt.terminalCause
        ) {
          return;
        }
      }
      if (destroyed) throw new Error("Discord IPC client was destroyed");

      const ownedLoginGeneration = ++loginGeneration;
      const previousAttempt = activeAttempt;
      if (previousAttempt) {
        terminalizeAttempt(previousAttempt, new Error("Discord IPC login was superseded"), true);
      }

      let lastError: Error | null = null;
      let connectedAttempt: DiscordIpcConnectionAttempt | null = null;
      for (const endpoint of endpointCandidates()) {
        if (destroyed || ownedLoginGeneration !== loginGeneration) {
          throw currentLoginError();
        }

        const attempt: DiscordIpcConnectionAttempt = {
          loginGeneration: ownedLoginGeneration,
          accumulator: new DiscordIpcFrameAccumulator(),
          socket: null,
          terminalCause: null,
          ready: false,
          readyResolver: null,
          readyRejecter: null,
        };
        activeAttempt = attempt;
        try {
          const connectedSocket = await connector(endpoint, {
            onData: (data) => {
              if (isActiveAttempt(attempt)) handleDataSafely(attempt, data);
            },
            onClose: () => {
              terminalizeAttempt(attempt, new Error("Discord IPC connection closed"), false);
            },
            onError: (error) => {
              if (!isActiveAttempt(attempt)) return;
              const cause = toError(error);
              terminalizeAttempt(attempt, cause, true);
            },
          });
          attempt.socket = connectedSocket;
          if (destroyed || ownedLoginGeneration !== loginGeneration) {
            terminalizeAttempt(attempt, currentLoginError(), true);
            throw currentLoginError();
          }
          if (!isActiveAttempt(attempt) || attempt.terminalCause) {
            lastError = terminalizeAttempt(
              attempt,
              new Error("Discord IPC connection ended while connecting"),
              true,
            );
            continue;
          }
          connectedAttempt = attempt;
          break;
        } catch (error) {
          const cause = toError(error);
          if (destroyed || ownedLoginGeneration !== loginGeneration) {
            terminalizeAttempt(attempt, cause, true);
            throw currentLoginError();
          }
          if (!isActiveAttempt(attempt) || attempt.terminalCause) {
            lastError = terminalizeAttempt(attempt, cause, true);
            continue;
          }
          lastError = terminalizeAttempt(attempt, cause, false);
        }
      }
      if (!connectedAttempt?.socket) {
        throw new Error(
          `Could not connect to Discord IPC${lastError ? `: ${normalizeErrorMessage(lastError)}` : ""}`,
        );
      }

      const attempt = connectedAttempt;
      const connectedSocket = attempt.socket;
      if (!connectedSocket) throw new Error("Discord IPC connection ended while connecting");
      const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          attempt.readyResolver = null;
          attempt.readyRejecter = null;
          reject(new Error("Discord IPC ready timed out"));
        }, timeoutMs);
        attempt.readyResolver = () => {
          clearTimeout(timeout);
          resolve();
        };
        attempt.readyRejecter = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
        if (attempt.ready) attempt.readyResolver();
      });
      try {
        connectedSocket.write(
          encodeDiscordIpcPacket(0, {
            v: DISCORD_IPC_VERSION,
            client_id: input.clientId,
          }),
        );
      } catch (error) {
        terminalizeAttempt(attempt, toError(error), true);
      }
      try {
        await readyPromise;
      } catch (error) {
        const cause = attempt.terminalCause ?? toError(error);
        terminalizeAttempt(attempt, cause, true);
        throw cause;
      }
      if (attempt.terminalCause) throw attempt.terminalCause;
      if (
        destroyed ||
        ownedLoginGeneration !== loginGeneration ||
        attempt.loginGeneration !== ownedLoginGeneration ||
        !isActiveAttempt(attempt) ||
        attempt.socket !== connectedSocket ||
        !attempt.ready
      ) {
        const cause = currentLoginError();
        terminalizeAttempt(attempt, cause, true);
        throw cause;
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
      loginGeneration += 1;
      const attempt = activeAttempt;
      const targetSocket = attempt?.socket ?? null;
      const destroyedError = new Error("Discord IPC client was destroyed");
      if (attempt) {
        terminalizeAttempt(attempt, destroyedError, false);
      } else {
        rejectAll(destroyedError);
      }
      if (targetSocket) {
        try {
          targetSocket.write(encodeDiscordIpcPacket(2, {}));
        } catch {
          // Ignore close-frame failures; socket teardown is best effort.
        }
        endSocketBestEffort(targetSocket);
      }
    },
    on(event, callback) {
      if (event !== "ready") return;
      readyCallbacks.add(callback);
      const attempt = activeAttempt;
      if (attempt?.ready && !attempt.terminalCause) notifyReadyBestEffort(callback);
    },
  };
}

function isDiscordIpcPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  try {
    return error instanceof Error ? error : new Error(normalizeErrorMessage(error));
  } catch {
    return new Error("Unknown Discord IPC error");
  }
}

function normalizeErrorMessage(error: unknown): string {
  let raw: string;
  try {
    raw = String(error).trim();
  } catch {
    return "Unknown Discord IPC error";
  }
  return raw.startsWith("Error: ") ? raw.slice("Error: ".length) : raw;
}
