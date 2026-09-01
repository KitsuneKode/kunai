import { randomBytes } from "node:crypto";
import { connect as connectTls, type TLSSocket } from "node:tls";

const RECEIVER_ID = "receiver-0";
export const DEFAULT_MEDIA_RECEIVER_APP_ID = "CC1AD845";
const CONNECTION_NAMESPACE = "urn:x-cast:com.google.cast.tp.connection";
const HEARTBEAT_NAMESPACE = "urn:x-cast:com.google.cast.tp.heartbeat";
const RECEIVER_NAMESPACE = "urn:x-cast:com.google.cast.receiver";
const MEDIA_NAMESPACE = "urn:x-cast:com.google.cast.media";
const KUNAI_RECEIVER_NAMESPACE = "urn:x-cast:dev.kunai.receiver.v1";

export type KunaiReceiverClock = {
  readonly type: "clock";
  readonly state?: "IDLE" | "BUFFERING" | "PLAYING" | "PAUSED";
  readonly currentTime?: number;
  readonly duration?: number;
  readonly observedAt?: number;
};

export type CastMediaStatus = {
  readonly mediaSessionId?: number;
  readonly playerState?: "IDLE" | "BUFFERING" | "PLAYING" | "PAUSED";
  readonly idleReason?: "CANCELLED" | "INTERRUPTED" | "FINISHED" | "ERROR";
  readonly currentTime?: number;
  readonly media?: { readonly duration?: number };
};

export type GoogleCastMedia = {
  readonly contentId: string;
  readonly contentType: string;
  readonly streamType: "BUFFERED" | "LIVE";
  readonly metadata: { readonly metadataType: 0; readonly title: string };
  readonly tracks?: readonly GoogleCastMediaTrack[];
};

export type GoogleCastMediaTrack = {
  readonly trackId: number;
  readonly type: "TEXT";
  readonly trackContentId: string;
  readonly trackContentType: "text/vtt";
  readonly subtype: "SUBTITLES";
  readonly name: string;
  readonly language?: string;
};

export type GoogleCastClientEvents = {
  readonly onStatus: (status: CastMediaStatus) => void;
  readonly onReceiverClock?: (clock: KunaiReceiverClock) => void;
  readonly onError: (error: Error) => void;
  readonly onClose: () => void;
};

export interface GoogleCastSession {
  load(
    media: GoogleCastMedia,
    startAt: number,
    activeTrackIds?: readonly number[],
  ): Promise<CastMediaStatus>;
  play(): Promise<CastMediaStatus | undefined>;
  pause(): Promise<CastMediaStatus | undefined>;
  seek(seconds: number): Promise<CastMediaStatus | undefined>;
  stop(): Promise<CastMediaStatus | undefined>;
  close(): void;
}

export function buildCastMediaCommand(
  message: Record<string, unknown>,
  mediaSessionId?: number,
): Record<string, unknown> {
  if (message.type === "LOAD" || mediaSessionId === undefined) return message;
  return { ...message, mediaSessionId };
}

type CastEnvelope = {
  readonly sourceId: string;
  readonly destinationId: string;
  readonly namespace: string;
  readonly payload: string;
};

type PendingRequest = {
  readonly finish: (error: Error | null, message?: Record<string, unknown>) => void;
};

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return bytes;
}

function encodeField(field: number, value: string): number[] {
  const data = new TextEncoder().encode(value);
  return [...encodeVarint((field << 3) | 2), ...encodeVarint(data.length), ...data];
}

export function encodeCastEnvelope(envelope: CastEnvelope): Uint8Array {
  return Uint8Array.from([
    ...encodeVarint(8),
    ...encodeVarint(0),
    ...encodeField(2, envelope.sourceId),
    ...encodeField(3, envelope.destinationId),
    ...encodeField(4, envelope.namespace),
    ...encodeVarint(40),
    ...encodeVarint(0),
    ...encodeField(6, envelope.payload),
  ]);
}

function decodeVarint(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  for (let shift = 0; shift < 35 && offset < bytes.length; shift += 7) {
    const byte = bytes[offset++] ?? 0;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: offset };
  }
  return null;
}

export function decodeCastEnvelope(bytes: Uint8Array): CastEnvelope | null {
  const strings = new Map<number, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const key = decodeVarint(bytes, offset);
    if (!key) return null;
    offset = key.next;
    const field = key.value >>> 3;
    const wire = key.value & 7;
    if (wire === 0) {
      const value = decodeVarint(bytes, offset);
      if (!value) return null;
      offset = value.next;
      continue;
    }
    if (wire !== 2) return null;
    const length = decodeVarint(bytes, offset);
    if (!length || length.next + length.value > bytes.length) return null;
    const data = bytes.subarray(length.next, length.next + length.value);
    if (field >= 2 && field <= 6) strings.set(field, new TextDecoder().decode(data));
    offset = length.next + length.value;
  }
  const sourceId = strings.get(2);
  const destinationId = strings.get(3);
  const namespace = strings.get(4);
  const payload = strings.get(6);
  return sourceId && destinationId && namespace && payload
    ? { sourceId, destinationId, namespace, payload }
    : null;
}

function frameEnvelope(envelope: CastEnvelope): Uint8Array {
  const payload = encodeCastEnvelope(envelope);
  const frame = new Uint8Array(payload.length + 4);
  new DataView(frame.buffer).setUint32(0, payload.length);
  frame.set(payload, 4);
  return frame;
}

function mediaStatus(message: Record<string, unknown>): CastMediaStatus | undefined {
  const statuses = message.status;
  return Array.isArray(statuses) ? (statuses[0] as CastMediaStatus | undefined) : undefined;
}

export async function connectGoogleCast(
  endpoint: { readonly host: string; readonly port?: number },
  events: GoogleCastClientEvents,
  signal?: AbortSignal,
  receiverAppId = DEFAULT_MEDIA_RECEIVER_APP_ID,
): Promise<GoogleCastSession> {
  const sourceId = `sender-${randomBytes(4).toString("hex")}`;
  const pending = new Map<number, PendingRequest>();
  let requestId = 0;
  let mediaDestination = RECEIVER_ID;
  let mediaSessionId: number | undefined;
  let incoming = new Uint8Array();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const socket = await new Promise<TLSSocket>((resolve, reject) => {
    const tls = connectTls({
      host: endpoint.host,
      port: endpoint.port ?? 8009,
      rejectUnauthorized: false,
    });
    const onAbort = () => {
      tls.destroy();
      reject(new Error(`Google Cast connection aborted: ${String(signal?.reason ?? "timeout")}`));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    tls.once("secureConnect", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(tls);
    });
    tls.once("error", reject);
  });

  const send = (namespace: string, destinationId: string, message: Record<string, unknown>) => {
    socket.write(
      frameEnvelope({
        sourceId,
        destinationId,
        namespace,
        payload: JSON.stringify(message),
      }),
    );
  };
  const request = (namespace: string, destinationId: string, message: Record<string, unknown>) => {
    const id = ++requestId;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Google Cast request timed out: ${String(message.type ?? "request")}`));
      }, 8_000);
      pending.set(id, {
        finish: (error, response) => {
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve(response ?? {});
        },
      });
      send(namespace, destinationId, { ...message, requestId: id });
    });
  };
  const handleEnvelope = (envelope: CastEnvelope) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(envelope.payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (envelope.namespace === HEARTBEAT_NAMESPACE && message.type === "PING") {
      send(HEARTBEAT_NAMESPACE, envelope.sourceId, { type: "PONG" });
      return;
    }
    if (envelope.namespace === KUNAI_RECEIVER_NAMESPACE && message.type === "clock") {
      events.onReceiverClock?.(message as KunaiReceiverClock);
      return;
    }
    const id = typeof message.requestId === "number" ? message.requestId : undefined;
    if (id !== undefined) {
      const waiter = pending.get(id);
      if (waiter) {
        pending.delete(id);
        const failed = typeof message.type === "string" && message.type.endsWith("ERROR");
        waiter.finish(failed ? new Error(`Google Cast ${message.type}`) : null, message);
      }
    }
    if (envelope.namespace === MEDIA_NAMESPACE) {
      const status = mediaStatus(message);
      if (status) {
        mediaSessionId = status.mediaSessionId ?? mediaSessionId;
        events.onStatus(status);
      }
    }
  };
  socket.on("data", (chunk) => {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    const merged = new Uint8Array(incoming.length + bytes.length);
    merged.set(incoming);
    merged.set(bytes, incoming.length);
    incoming = merged;
    while (incoming.length >= 4) {
      const length = new DataView(
        incoming.buffer,
        incoming.byteOffset,
        incoming.byteLength,
      ).getUint32(0);
      if (incoming.length < length + 4) break;
      const envelope = decodeCastEnvelope(incoming.subarray(4, length + 4));
      incoming = incoming.slice(length + 4);
      if (envelope) handleEnvelope(envelope);
    }
  });
  socket.on("error", events.onError);
  socket.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);
    for (const waiter of pending.values())
      waiter.finish(new Error("Google Cast connection closed"));
    pending.clear();
    events.onClose();
  });

  send(CONNECTION_NAMESPACE, RECEIVER_ID, { type: "CONNECT" });
  send(HEARTBEAT_NAMESPACE, RECEIVER_ID, { type: "PING" });
  heartbeat = setInterval(() => send(HEARTBEAT_NAMESPACE, RECEIVER_ID, { type: "PING" }), 5_000);
  const launch = await request(RECEIVER_NAMESPACE, RECEIVER_ID, {
    type: "LAUNCH",
    appId: receiverAppId,
  });
  const applications = (launch.status as { applications?: unknown[] } | undefined)?.applications;
  const application = Array.isArray(applications)
    ? (applications.find(
        (candidate) => (candidate as { appId?: string }).appId === receiverAppId,
      ) as { transportId?: string } | undefined)
    : undefined;
  if (!application?.transportId) {
    socket.destroy();
    throw new Error(`Google Cast receiver ${receiverAppId} did not launch`);
  }
  mediaDestination = application.transportId;
  send(CONNECTION_NAMESPACE, mediaDestination, { type: "CONNECT" });
  if (receiverAppId !== DEFAULT_MEDIA_RECEIVER_APP_ID) {
    send(KUNAI_RECEIVER_NAMESPACE, mediaDestination, { type: "clock-request" });
  }

  const mediaRequest = async (message: Record<string, unknown>) => {
    const response = await request(
      MEDIA_NAMESPACE,
      mediaDestination,
      buildCastMediaCommand(message, mediaSessionId),
    );
    const status = mediaStatus(response);
    mediaSessionId = status?.mediaSessionId ?? mediaSessionId;
    return status;
  };
  return {
    load: async (media, startAt, activeTrackIds) => {
      const status = await mediaRequest({
        type: "LOAD",
        media,
        autoplay: true,
        currentTime: startAt,
        ...(activeTrackIds?.length ? { activeTrackIds } : {}),
      });
      if (!status) throw new Error("Google Cast returned no media status after LOAD");
      return status;
    },
    play: () => mediaRequest({ type: "PLAY" }),
    pause: () => mediaRequest({ type: "PAUSE" }),
    seek: (seconds) => mediaRequest({ type: "SEEK", currentTime: seconds }),
    stop: () => mediaRequest({ type: "STOP" }),
    close: () => socket.destroy(),
  };
}
