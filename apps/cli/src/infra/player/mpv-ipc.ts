import { StringDecoder } from "node:string_decoder";

import type { MpvIpcEndpoint } from "./mpv-ipc-endpoint";

export const MPV_OBSERVED_PROPERTIES = [
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
] as const;

export const MPV_INITIAL_PROPERTIES = ["playback-time", "duration", "percent-pos"] as const;

type MpvIpcMessage = {
  event?: string;
  name?: string;
  data?: unknown;
  request_id?: number;
  error?: string;
  reason?: string;
  /** mpv end-file: approximate failure reason when playback did not complete cleanly. */
  file_error?: string;
};

type PropertyUpdateHandler = (message: {
  name: string;
  value: unknown;
  observedAt: number;
}) => void;

type EndFileHandler = (message: {
  reason?: string;
  fileError?: string;
  observedAt: number;
}) => void;
type FileLoadedHandler = (message: { observedAt: number }) => void;

export type MpvIpcSessionOptions = {
  endpoint: MpvIpcEndpoint;
  onPropertyUpdate: PropertyUpdateHandler;
  onEndFile: EndFileHandler;
  onFileLoaded?: FileLoadedHandler;
  onCommandResult?: (result: MpvIpcCommandResult) => void;
  closeTimers?: MpvIpcCloseTimers;
  commandTimers?: MpvIpcCloseTimers;
};

export type MpvIpcCloseTimers = {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

const defaultCloseTimers: MpvIpcCloseTimers = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type MpvIpcSessionState =
  | "starting"
  | "waiting-for-socket"
  | "connected"
  | "playing"
  | "idle"
  | "closing"
  | "closed"
  | "failed";

export type MpvIpcCommandResult =
  | { ok: true; command: readonly unknown[]; requestId: number; response: MpvIpcMessage }
  | { ok: false; command: readonly unknown[]; requestId: number; error: string };

type PendingCommand = {
  command: readonly unknown[];
  resolve: (result: MpvIpcCommandResult) => void;
  timeout: unknown;
};

// Per-socket state threaded through Bun's data field so the close handler
// can resolve an in-flight close() call.
type SocketState = { onClose: (() => void) | null };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Encode one newline-delimited mpv command, optionally correlated with a response. */
export function buildMpvIpcCommand(command: readonly unknown[], requestId?: number): string {
  const payload =
    requestId === undefined ? { command } : { command, request_id: Math.trunc(requestId) };
  return `${JSON.stringify(payload)}\n`;
}

/** Parse one complete IPC line; malformed and non-object payloads are ignored. */
export function parseMpvIpcLine(raw: string): MpvIpcMessage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return isObject(parsed) ? (parsed as MpvIpcMessage) : null;
  } catch {
    return null;
  }
}

/** Probe IPC by connecting and closing immediately on success (Unix UDS or Windows pipe via `unix:` path). */
export async function waitForMpvIpcEndpoint(
  endpoint: MpvIpcEndpoint,
  timeoutMs = 3_000,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let delay = 10;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    try {
      const s = await Bun.connect<SocketState>({
        unix: endpoint.path,
        data: { onClose: null },
        socket: {
          open(sock) {
            sock.end();
          },
          data() {},
          close() {},
          error() {},
        },
      });
      void s;
      return true;
    } catch {
      // Pipe/socket not ready yet — retry after backoff.
    }
    if (signal?.aborted) return false;
    await Bun.sleep(delay);
    delay = Math.min(delay * 2, 100);
  }
  return false;
}

/** @deprecated Prefer `waitForMpvIpcEndpoint` + `createMpvIpcEndpoint`; kept for tests and legacy callers. */
export async function waitForMpvIpcSocket(socketPath: string, timeoutMs = 3_000): Promise<boolean> {
  return waitForMpvIpcEndpoint({ kind: "unix_socket", path: socketPath }, timeoutMs);
}

export interface MpvIpcSession {
  send(command: readonly unknown[], timeoutMs?: number): Promise<MpvIpcCommandResult>;
  sendUnchecked(command: readonly unknown[]): void;
  close(): Promise<void>;
}

/**
 * Open a bounded, byte-ordered IPC session. Commands settle once on response,
 * deadline, or close; expiry during a partial write closes the damaged stream.
 */
export async function openMpvIpcSession(options: MpvIpcSessionOptions): Promise<MpvIpcSession> {
  const closeTimers = options.closeTimers ?? defaultCloseTimers;
  const commandTimers = options.commandTimers ?? defaultCloseTimers;
  const requestIds = new Map<number, string>();
  const pendingCommands = new Map<number, PendingCommand>();
  let nextRequestId = 1;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let bufferValue = "";
  const writes: Array<{ bytes: Buffer; offset: number; requestId?: number }> = [];
  let queuedBytes = 0;
  let waitingForDrain = false;
  // Bound stalled IPC independently of the number of UI events producing commands.
  const maxQueuedBytes = 256 * 1024;
  const decoder = new StringDecoder("utf8");

  const drainPending = (error: string, timedOutRequestId?: number) => {
    for (const [requestId, pending] of Array.from(pendingCommands)) {
      pending.resolve({
        ok: false,
        command: pending.command,
        requestId,
        error: requestId === timedOutRequestId ? "timeout" : error,
      });
    }
  };

  const markClosed = (error = "session closed", timedOutRequestId?: number) => {
    if (closed) return;
    closed = true;
    writes.length = 0;
    queuedBytes = 0;
    drainPending(error, timedOutRequestId);
  };

  const flushWrites = (sock: Bun.Socket<SocketState>) => {
    if (closed || waitingForDrain) return;
    try {
      for (let entry = writes[0]; entry !== undefined; entry = writes[0]) {
        const remaining = entry.bytes.subarray(entry.offset);
        const accepted = sock.write(remaining);
        if (accepted < 0) throw new Error("mpv IPC socket is closed");
        if (accepted > remaining.length) throw new Error("invalid mpv IPC write result");
        entry.offset += accepted;
        queuedBytes -= accepted;
        if (entry.offset < entry.bytes.length) {
          waitingForDrain = true;
          return;
        }
        writes.shift();
      }
    } catch (error) {
      markClosed(error instanceof Error ? error.message : String(error));
      sock.terminate();
    }
  };

  const socket = await Bun.connect<SocketState>({
    unix: options.endpoint.path,
    data: { onClose: null },
    socket: {
      open() {},
      drain(sock) {
        waitingForDrain = false;
        flushWrites(sock);
      },
      data(_socket, data) {
        if (closed) return;
        bufferValue += decoder.write(data);
        let nl = bufferValue.indexOf("\n");
        while (nl !== -1) {
          const line = bufferValue.slice(0, nl);
          bufferValue = bufferValue.slice(nl + 1);
          const parsed = parseMpvIpcLine(line);
          if (parsed) {
            dispatchMessage(
              parsed,
              requestIds,
              pendingCommands,
              options.onPropertyUpdate,
              options.onEndFile,
              options.onFileLoaded,
            );
          }
          nl = bufferValue.indexOf("\n");
        }
      },
      close(sock) {
        sock.data.onClose?.();
        sock.data.onClose = null;
        markClosed("session closed");
      },
      error(sock, _error) {
        sock.data.onClose?.();
        sock.data.onClose = null;
        markClosed("socket error");
      },
    },
  });

  // Subscribe to all observed properties and request initial values in a single write.
  let initPayload = "";
  for (const name of MPV_OBSERVED_PROPERTIES) {
    initPayload += buildMpvIpcCommand(["observe_property", nextRequestId, name], nextRequestId);
    nextRequestId++;
  }
  for (const name of MPV_INITIAL_PROPERTIES) {
    const id = nextRequestId++;
    requestIds.set(id, name);
    initPayload += buildMpvIpcCommand(["get_property", name], id);
  }
  const enqueueWrite = (payload: string, requestId?: number) => {
    if (closed || socket.readyState !== 1) throw new Error("mpv IPC session is closed");
    const bytes = Buffer.from(payload, "utf8");
    if (queuedBytes + bytes.length > maxQueuedBytes) throw new Error("mpv IPC write queue is full");
    writes.push({ bytes, offset: 0, requestId });
    queuedBytes += bytes.length;
    flushWrites(socket);
    if (closed) throw new Error("mpv IPC session is closed");
  };
  enqueueWrite(initPayload);

  const writeCommand = (command: readonly unknown[], requestId?: number) => {
    if (closed || socket.readyState !== 1) {
      throw new Error("mpv IPC session is closed");
    }
    enqueueWrite(buildMpvIpcCommand(command, requestId), requestId);
  };

  return {
    send(command, timeoutMs = 1_000) {
      const requestId = nextRequestId++;
      return new Promise<MpvIpcCommandResult>((resolve) => {
        if (closed || socket.readyState !== 1) {
          const result: MpvIpcCommandResult = {
            ok: false,
            command,
            requestId,
            error: "session closed",
          };
          resolve(result);
          options.onCommandResult?.(result);
          return;
        }
        let settled = false;
        const finish = (result: MpvIpcCommandResult) => {
          if (settled) return;
          settled = true;
          const pending = pendingCommands.get(requestId);
          if (pending) {
            commandTimers.clearTimeout(pending.timeout);
            pendingCommands.delete(requestId);
          }
          // The `settled` guard above makes timeout/write-error/response races single-shot.
          // eslint-disable-next-line promise/no-multiple-resolved
          resolve(result);
          options.onCommandResult?.(result);
        };
        const timeout = commandTimers.setTimeout(() => {
          const index = writes.findIndex((entry) => entry.requestId === requestId);
          const entry = writes[index];
          if (entry && entry.offset > 0) {
            // Dropping half a JSON line corrupts the next command; completing it
            // after its deadline could launch playback the user already cancelled.
            markClosed("partial IPC write timed out", requestId);
            socket.terminate();
            return;
          } else if (entry) {
            queuedBytes -= entry.bytes.length;
            writes.splice(index, 1);
          }
          // Fence queued bytes before notifying code that can re-enter this session.
          finish({ ok: false, command, requestId, error: "timeout" });
        }, timeoutMs);
        pendingCommands.set(requestId, { command, resolve: finish, timeout });
        try {
          writeCommand(command, requestId);
        } catch (error) {
          finish({
            ok: false,
            command,
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },

    sendUnchecked(command) {
      try {
        writeCommand(command);
      } catch {
        // best-effort — session may already be closing
      }
    },

    async close() {
      if (closePromise) {
        await closePromise;
        return;
      }

      closePromise = (async () => {
        markClosed("session closed");
        if (socket.readyState !== 1) return;
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return false;
            settled = true;
            socket.data.onClose = null;
            resolve();
            return true;
          };
          // The fallback has to be cleared when the socket closes cleanly.
          // Uncleared it fires 200ms later against an already-closed socket,
          // and `close()` runs on every session release, not only at exit — so
          // each released mpv session left one behind.
          const fallback = closeTimers.setTimeout(() => {
            if (!finish()) return;
            socket.terminate();
          }, 200);
          socket.data.onClose = () => {
            closeTimers.clearTimeout(fallback);
            finish();
          };
          socket.end();
        });
      })();

      await closePromise;
    },
  };
}

function dispatchMessage(
  message: MpvIpcMessage,
  requestIds: Map<number, string>,
  pendingCommands: Map<number, PendingCommand>,
  onPropertyUpdate: PropertyUpdateHandler,
  onEndFile: EndFileHandler,
  onFileLoaded?: FileLoadedHandler,
) {
  const observedAt = Date.now();

  if (message.event === "property-change" && typeof message.name === "string") {
    onPropertyUpdate({ name: message.name, value: message.data, observedAt });
    return;
  }

  if (message.event === "end-file") {
    onEndFile({
      reason: message.reason,
      fileError: typeof message.file_error === "string" ? message.file_error : undefined,
      observedAt,
    });
    return;
  }

  if (message.event === "file-loaded") {
    onFileLoaded?.({ observedAt });
    return;
  }

  if (typeof message.request_id === "number" && pendingCommands.has(message.request_id)) {
    const pending = pendingCommands.get(message.request_id);
    if (!pending) return;

    const result: MpvIpcCommandResult =
      message.error === "success"
        ? {
            ok: true,
            command: pending.command,
            requestId: message.request_id,
            response: message,
          }
        : {
            ok: false,
            command: pending.command,
            requestId: message.request_id,
            error: message.error ?? "unknown mpv ipc error",
          };
    pending.resolve(result);
    return;
  }

  if (typeof message.request_id === "number" && requestIds.has(message.request_id)) {
    const name = requestIds.get(message.request_id);
    requestIds.delete(message.request_id);
    if (name && message.error === "success") {
      onPropertyUpdate({ name, value: message.data, observedAt });
    }
  }
}
