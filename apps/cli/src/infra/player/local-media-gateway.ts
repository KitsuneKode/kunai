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
  readonly scheduleIdle?: (task: () => void, delayMs: number) => () => void;
};

export function startLocalMediaGateway(
  options: StartLocalMediaGatewayOptions = {},
): LocalMediaGatewayHandle {
  const token = crypto.randomUUID().replace(/-/g, "");
  const mounts = new Map<string, GatewayTorrentMount>();
  let stopped = false;
  let cancelIdle: (() => void) | null = null;
  const activeReads = new Set<AbortController>();
  const scheduleIdle =
    options.scheduleIdle ??
    ((task: () => void, delayMs: number) => {
      const timer = setTimeout(task, delayMs);
      return () => clearTimeout(timer);
    });
  let closeGateway: ((reason: LocalMediaGatewayStopReason) => void) | null = null;

  function resetIdleTimer() {
    cancelIdle?.();
    cancelIdle = null;
    const closer = closeGateway;
    if (!closer || stopped || activeReads.size > 0) return;
    cancelIdle = scheduleIdle(() => {
      // A captured timer may already be queued when a read begins.
      if (activeReads.size === 0) closer("idle");
    }, IDLE_TIMEOUT_MS);
  }

  function tokenOk(path: string): boolean {
    return path.startsWith(`/t/${token}/`);
  }

  function iterableToResponse(
    source: AsyncIterable<Uint8Array>,
    controller: AbortController,
    requestSignal: AbortSignal,
  ): ReadableStream<Uint8Array> {
    const iterator = source[Symbol.asyncIterator]();
    let finished = false;
    const onRequestAbort = () => controller.abort();
    const finish = () => {
      if (finished) return;
      finished = true;
      requestSignal.removeEventListener("abort", onRequestAbort);
      activeReads.delete(controller);
      resetIdleTimer();
    };
    requestSignal.addEventListener("abort", onRequestAbort, { once: true });
    controller.signal.addEventListener("abort", finish, { once: true });
    if (requestSignal.aborted) controller.abort();
    return new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          controller.signal.throwIfAborted();
          const next = await iterator.next();
          controller.signal.throwIfAborted();
          if (next.done) {
            finish();
            stream.close();
          } else stream.enqueue(next.value);
        } catch (error) {
          finish();
          stream.error(error);
        }
      },
      async cancel() {
        controller.abort();
        finish();
        await iterator.return?.();
      },
    });
  }

  const server: Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (stopped) return new Response("gateway stopped", { status: 503 });
      const url = new URL(req.url);
      if (!tokenOk(url.pathname)) return new Response("forbidden", { status: 403 });

      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }

      // ── Torrent file serving ──────────────────────────────────────
      if (url.pathname.startsWith(`/t/${token}/`)) {
        const rest = url.pathname.slice(`/t/${token}/`.length);
        const slash = rest.indexOf("/");
        const mountId = slash === -1 ? rest : rest.slice(0, slash);
        const mount = mounts.get(mountId);
        if (!mount) return new Response("unknown torrent mount", { status: 404 });
        const total = mount.fileLength;
        resetIdleTimer();
        const rangeHeader = req.headers.get("range");
        const parsed =
          rangeHeader === null
            ? { ok: true as const, range: { start: 0, end: total - 1 } }
            : parseGatewayRange(rangeHeader, total);
        if (!parsed.ok) {
          return new Response("invalid range", {
            status: 416,
            headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${total}` },
          });
        }
        const { start, end } = parsed.range;
        const length = end - start + 1;
        const headers: Record<string, string> = {
          "Content-Type": mount.contentType,
          "Content-Length": String(length),
          "Accept-Ranges": "bytes",
        };
        if (rangeHeader !== null) headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
        const status = rangeHeader === null ? 200 : 206;
        if (req.method === "HEAD") return new Response(null, { status, headers });
        if (activeReads.size >= 4) return new Response("too many active reads", { status: 503 });
        const controller = new AbortController();
        activeReads.add(controller);
        resetIdleTimer();
        try {
          const body = iterableToResponse(
            mount.readRange(start, end, controller.signal),
            controller,
            req.signal,
          );
          return new Response(body, { status, headers });
        } catch {
          controller.abort();
          activeReads.delete(controller);
          resetIdleTimer();
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
    cancelIdle?.();
    cancelIdle = null;
    for (const controller of activeReads) controller.abort();
    activeReads.clear();
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
      if (stopped) throw new Error("gateway stopped");
      if (
        !/^[a-zA-Z0-9_-]+$/.test(mount.mountId) ||
        !Number.isSafeInteger(mount.fileLength) ||
        mount.fileLength <= 0
      ) {
        throw new Error("invalid torrent mount");
      }
      if (!mounts.has(mount.mountId) && mounts.size >= 16)
        throw new Error("too many torrent mounts");
      mounts.set(mount.mountId, mount);
      return `${origin}/t/${token}/${mount.mountId}/${encodeURIComponent("stream")}`;
    },
    unmountTorrentFile: (mountId: string) => {
      mounts.delete(mountId);
    },
  };
}
