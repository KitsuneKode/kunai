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
};

type PropertyUpdateHandler = (message: {
  name: string;
  value: unknown;
  observedAt: number;
}) => void;

type EndFileHandler = (message: { reason?: string; observedAt: number }) => void;
type FileLoadedHandler = (message: { observedAt: number }) => void;

type SessionOptions = {
  endpoint: MpvIpcEndpoint;
  onPropertyUpdate: PropertyUpdateHandler;
  onEndFile: EndFileHandler;
  onFileLoaded?: FileLoadedHandler;
  onCommandResult?: (result: MpvIpcCommandResult) => void;
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
  timeout: ReturnType<typeof setTimeout>;
};

// Per-socket state threaded through Bun's data field so the close handler
// can resolve an in-flight close() call.
type SocketState = { onClose: (() => void) | null };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildMpvIpcCommand(command: readonly unknown[], requestId?: number): string {
  const payload =
    requestId === undefined ? { command } : { command, request_id: Math.trunc(requestId) };
  return `${JSON.stringify(payload)}\n`;
}

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
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let delay = 10;
  while (Date.now() < deadline) {
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

export async function openMpvIpcSession(options: SessionOptions): Promise<MpvIpcSession> {
  const requestIds = new Map<number, string>();
  const pendingCommands = new Map<number, PendingCommand>();
  let nextRequestId = 1;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let bufferValue = "";

  const drainPending = (error: string) => {
    for (const [requestId, pending] of Array.from(pendingCommands)) {
      clearTimeout(pending.timeout);
      pendingCommands.delete(requestId);
      pending.resolve({ ok: false, command: pending.command, requestId, error });
    }
  };

  const markClosed = (error = "session closed") => {
    if (closed) return;
    closed = true;
    drainPending(error);
  };

  const socket = await Bun.connect<SocketState>({
    unix: options.endpoint.path,
    data: { onClose: null },
    socket: {
      open() {},
      data(_socket, data) {
        if (closed) return;
        bufferValue += data.toString();
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
  socket.write(initPayload);

  const writeCommand = (command: readonly unknown[], requestId?: number) => {
    if (closed || socket.readyState !== 1) {
      throw new Error("mpv IPC session is closed");
    }
    socket.write(buildMpvIpcCommand(command, requestId));
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
        const finish = (result: MpvIpcCommandResult) => {
          const pending = pendingCommands.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingCommands.delete(requestId);
          }
          resolve(result);
          options.onCommandResult?.(result);
        };
        const timeout = setTimeout(() => {
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
          socket.data.onClose = resolve;
          socket.end();
          setTimeout(() => {
            socket.terminate();
            resolve();
          }, 200);
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
    onEndFile({ reason: message.reason, observedAt });
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
    clearTimeout(pending.timeout);
    pendingCommands.delete(message.request_id);
    pending.resolve(result);
    return;
  }

  if (
    typeof message.request_id === "number" &&
    requestIds.has(message.request_id) &&
    message.error === "success"
  ) {
    const name = requestIds.get(message.request_id);
    if (!name) return;
    requestIds.delete(message.request_id);
    onPropertyUpdate({ name, value: message.data, observedAt });
  }
}
