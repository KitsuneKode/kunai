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
  close(): Promise<void>;
}

export async function openMpvIpcSession(options: SessionOptions): Promise<MpvIpcSession> {
  const socket = await connectSocket(options.socketPath);
  const requestIds = new Map<number, string>();
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
        dispatchMessage(parsed, requestIds, options.onPropertyUpdate, options.onEndFile);
      }
      newlineIndex = bufferState.value.indexOf("\n");
    }
  });

  const send = (command: readonly unknown[], requestId?: number) => {
    socket.write(buildMpvIpcCommand(command, requestId));
  };

  for (const name of MPV_OBSERVED_PROPERTIES) {
    send(["observe_property", nextRequestId, name], nextRequestId);
    nextRequestId += 1;
  }

  for (const name of MPV_INITIAL_PROPERTIES) {
    const requestId = nextRequestId++;
    requestIds.set(requestId, name);
    send(["get_property", name], requestId);
  }

  return {
    async close() {
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
