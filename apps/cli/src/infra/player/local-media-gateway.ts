import type { Server } from "bun";

/**
 * Local torrent file serving, bound to 127.0.0.1 and a per-session token.
 * This gateway never fetches provider targets or accepts upstream credentials.
 * Header-bearing provider media belongs to the separate Android stream gateway.
 */

export type LocalMediaGatewayStopReason = "playback-end" | "session-release" | "idle" | "error";

export interface LocalMediaGatewayHandle {
  readonly origin: string;
  readonly stop: (reason?: LocalMediaGatewayStopReason) => void;
  readonly mountTorrentFile: (mount: GatewayTorrentMount) => string;
  readonly unmountTorrentFile: (mountId: string) => void;
}

export interface GatewayTorrentMount {
  readonly mountId: string;
  readonly fileName: string;
  readonly fileLength: number;
  readonly contentType: string;
  readonly readRange: (
    start: number,
    end: number,
    signal: AbortSignal,
  ) => AsyncIterable<Uint8Array>;
}

export type GatewayRange = { readonly start: number; readonly end: number };

/** Parse a single `bytes=start-end` range against a known length. */
export function parseGatewayRange(
  header: string | null,
  totalLength: number,
): { readonly ok: true; readonly range: GatewayRange } | { readonly ok: false } {
  if (!header) return { ok: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { ok: false };
  const start = match[1] === "" ? null : Number(match[1]);
  const end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return { ok: false };
  // Suffix ranges (`bytes=-500`) are valid HTTP but mpv never sends them for
  // progressive playback; answering 416 keeps the contract to one shape.
  if (start === null) return { ok: false };
  if (!Number.isSafeInteger(start) || (end !== null && !Number.isSafeInteger(end))) {
    return { ok: false };
  }
  if (start >= totalLength) return { ok: false };
  const resolvedEnd = end === null || end >= totalLength ? totalLength - 1 : end;
  if (resolvedEnd < start) return { ok: false };
  return { ok: true, range: { start, end: resolvedEnd } };
}

export function gatewayContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "application/octet-stream";
}

const IDLE_TIMEOUT_MS = 15 * 60_000;

export type StartLocalMediaGatewayOptions = {
  readonly onStopped?: (reason: LocalMediaGatewayStopReason) => void;
};

export function startLocalMediaGateway(
  options: StartLocalMediaGatewayOptions = {},
): LocalMediaGatewayHandle {
  const token = crypto.randomUUID().replace(/-/g, "");
  const mounts = new Map<string, GatewayTorrentMount>();
  let stopped = false;
  let idleTimer: Timer | null = null;
  let closeGateway: ((reason: LocalMediaGatewayStopReason) => void) | null = null;

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    const closer = closeGateway;
    if (!closer || stopped) return;
    idleTimer = setTimeout(() => closer("idle"), IDLE_TIMEOUT_MS);
  }

  function tokenOk(path: string): boolean {
    return path.startsWith(`/t/${token}/`);
  }

  async function iterableToResponse(
    source: AsyncIterable<Uint8Array>,
    onCancel: () => void,
  ): Promise<ReadableStream<Uint8Array>> {
    const iterator = source[Symbol.asyncIterator]();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        onCancel();
        void iterator.return?.();
      },
    });
  }

  const server: Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (stopped) return new Response("gateway stopped", { status: 503 });
      resetIdleTimer();
      const url = new URL(req.url);
      if (!tokenOk(url.pathname)) return new Response("forbidden", { status: 403 });

      // ── Torrent file serving ──────────────────────────────────────
      if (url.pathname.startsWith(`/t/${token}/`)) {
        const rest = url.pathname.slice(`/t/${token}/`.length);
        const slash = rest.indexOf("/");
        const mountId = slash === -1 ? rest : rest.slice(0, slash);
        const mount = mounts.get(mountId);
        if (!mount) return new Response("unknown torrent mount", { status: 404 });
        const total = mount.fileLength;
        const parsed = parseGatewayRange(req.headers.get("range"), total);
        if (!parsed.ok) {
          return new Response("range required", {
            status: 416,
            headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${total}` },
          });
        }
        const { start, end } = parsed.range;
        const length = end - start + 1;
        const controller = new AbortController();
        req.signal.addEventListener("abort", () => controller.abort(), { once: true });
        try {
          const body = await iterableToResponse(
            mount.readRange(start, end, controller.signal),
            () => controller.abort(),
          );
          return new Response(body, {
            status: 206,
            headers: {
              "Content-Type": mount.contentType,
              "Content-Length": String(length),
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Accept-Ranges": "bytes",
            },
          });
        } catch {
          return new Response("torrent read failed", { status: 502 });
        }
      }

      return new Response("unknown route", { status: 404 });
    },
  });

  const origin = `http://127.0.0.1:${server.port}`;
  const stop = (reason: LocalMediaGatewayStopReason = "playback-end") => {
    if (stopped) return;
    stopped = true;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    mounts.clear();
    server.stop(true);
    options.onStopped?.(reason);
  };
  closeGateway = stop;
  resetIdleTimer();

  return {
    origin,
    stop,
    mountTorrentFile: (mount: GatewayTorrentMount) => {
      mounts.set(mount.mountId, mount);
      return `${origin}/t/${token}/${mount.mountId}/${encodeURIComponent("stream")}`;
    },
    unmountTorrentFile: (mountId: string) => {
      mounts.delete(mountId);
    },
  };
}
