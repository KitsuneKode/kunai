import { createConnection, type Socket } from "node:net";

export const MPV_OBSERVED_PROPERTIES = [
  "time-pos",
  "playback-time",
  "duration",
  "percent-pos",
  "pause",
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

type SessionOptions = {
  socketPath: string;
  onPropertyUpdate: PropertyUpdateHandler;
  onEndFile: EndFileHandler;
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

export async function waitForMpvIpcSocket(socketPath: string, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const socket = createConnection(socketPath);
      const ready = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(value);
        };
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
      });
      if (ready) return true;
    } catch {
      // wait and retry
    }

    await Bun.sleep(50);
  }

  return false;
}

export interface MpvIpcSession {
  send(command: readonly unknown[], timeoutMs?: number): Promise<MpvIpcCommandResult>;
  sendUnchecked(command: readonly unknown[]): void;
  close(): Promise<void>;
}

export async function openMpvIpcSession(options: SessionOptions): Promise<MpvIpcSession> {
  const socket = await connectSocket(options.socketPath);
  const requestIds = new Map<number, string>();
  const pendingCommands = new Map<number, PendingCommand>();
  let nextRequestId = 1;

  const bufferState = { value: "" };
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    bufferState.value += chunk;
    let newlineIndex = bufferState.value.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = bufferState.value.slice(0, newlineIndex);
      bufferState.value = bufferState.value.slice(newlineIndex + 1);
      const parsed = parseMpvIpcLine(line);
      if (parsed) {
        dispatchMessage(
          parsed,
          requestIds,
          pendingCommands,
          options.onPropertyUpdate,
          options.onEndFile,
        );
      }
      newlineIndex = bufferState.value.indexOf("\n");
    }
  });

  const writeCommand = (command: readonly unknown[], requestId?: number) => {
    socket.write(buildMpvIpcCommand(command, requestId));
  };

  for (const name of MPV_OBSERVED_PROPERTIES) {
    writeCommand(["observe_property", nextRequestId, name], nextRequestId);
    nextRequestId += 1;
  }

  for (const name of MPV_INITIAL_PROPERTIES) {
    const requestId = nextRequestId++;
    requestIds.set(requestId, name);
    writeCommand(["get_property", name], requestId);
  }

  return {
    send(command, timeoutMs = 1_000) {
      const requestId = nextRequestId++;
      return new Promise<MpvIpcCommandResult>((resolve) => {
        const finish = (result: MpvIpcCommandResult) => {
          const pending = pendingCommands.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingCommands.delete(requestId);
          }
          options.onCommandResult?.(result);
          resolve(result);
        };
        const timeout = setTimeout(() => {
          finish({ ok: false, command, requestId, error: "timeout" });
        }, timeoutMs);
        timeout.unref?.();
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
      writeCommand(command);
    },
    async close() {
      for (const [requestId, pending] of pendingCommands) {
        clearTimeout(pending.timeout);
        pendingCommands.delete(requestId);
        pending.resolve({
          ok: false,
          command: pending.command,
          requestId,
          error: "session closed",
        });
      }
      await closeSocket(socket);
    },
  };
}

async function connectSocket(socketPath: string): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

async function closeSocket(socket: Socket): Promise<void> {
  if (socket.destroyed) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    socket.once("close", finish);
    socket.once("error", finish);
    socket.end();
    setTimeout(() => {
      socket.destroy();
      finish();
    }, 200).unref?.();
  });
}

function dispatchMessage(
  message: MpvIpcMessage,
  requestIds: Map<number, string>,
  pendingCommands: Map<number, PendingCommand>,
  onPropertyUpdate: PropertyUpdateHandler,
  onEndFile: EndFileHandler,
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

  if (typeof message.request_id === "number" && pendingCommands.has(message.request_id)) {
    const pending = pendingCommands.get(message.request_id)!;
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
    const name = requestIds.get(message.request_id)!;
    requestIds.delete(message.request_id);
    onPropertyUpdate({ name, value: message.data, observedAt });
  }
}
