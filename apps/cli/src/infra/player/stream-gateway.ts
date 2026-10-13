import crypto from "node:crypto";

import {
  blockedLiteralTargetReason,
  fetchGuardedStreamTarget,
  isHlsPlaylistUrl,
  resolveHlsSegmentUrl,
  type StreamReachabilityFetch,
} from "@kunai/core";
import type { Server } from "bun";

import {
  parseDashTemplate,
  rewriteDashManifest,
  substituteDashTemplate,
  UnsupportedDashManifestError,
  type DashTemplate,
} from "./dash-gateway-manifest";
import { fromB64Url, toB64Url } from "./hls-relay";
import { classifyManifestPrefix } from "./manifest-prefix";
import {
  normalizeStreamHttpHeaders,
  type NormalizedStreamHttpHeaders,
} from "./mpv-stream-http-headers";

/**
 * Loopback media gateway for launch-only players.
 *
 * Android player intents (`am start ... ACTION_VIEW`) hand VLC/mpv-android a
 * URL and nothing else — no headers, no cookies, no subtitle plumbing that the
 * managed mpv path takes for granted. This gateway sits between them: the
 * player fetches `127.0.0.1` paths, and the gateway issues the real upstream
 * request with exactly the candidate's normalized headers.
 *
 * Threat model, matching the plan text:
 * - 127.0.0.1 only, ephemeral port, one instance per process.
 * - Every route lives under an unguessable per-playback 128-bit token —
 *   `/g/<token>/…`; anything else answers 404. The token is minted when a
 *   handoff registers a stream, never logged, and revokes nothing else.
 * - The upstream allowlist is the probed candidate's origin plus origins seen
 *   in playlists/documents it serves. `/f/<b64>` refuses anything else, and a
 *   URI that fails the target guard is never rewritten into a playlist.
 * - Redirects are walked hop-by-hop by `fetchGuardedStreamTarget`: a hop to a
 *   private address, a local name, or a non-http(s) scheme is refused. This is
 *   the same DNS + literal-address guard the resolve probe uses, now shared
 *   through `@kunai/core`.
 */

/** Safety net only — the caller owns stop() for real lifetime. */
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000;
/** Playlists and MPDs are small; a hostile body is not allowed to be a movie. */
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const MAX_SNIFF_BYTES = 16 * 1024;
/**
 * `#EXTM3U` tolerant of a UTF-8 BOM or stray leading whitespace — some CDNs
 * prefix the magic, and an exact-offset match would stream the playlist
 * through unrewritten with its URIs bypassing the gateway.
 */
function looksLikePlaylistHead(chunk: Buffer): boolean {
  let offset = 0;
  if (chunk.byteLength >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
    offset = 3;
  }
  while (
    offset < chunk.byteLength &&
    (chunk[offset] === 0x20 ||
      chunk[offset] === 0x09 ||
      chunk[offset] === 0x0a ||
      chunk[offset] === 0x0d)
  ) {
    offset += 1;
  }
  return chunk.subarray(offset, offset + 7).equals(HLS_PLAYLIST_MAGIC);
}

/** `#EXTM3U`, as bytes — the same magic hls-relay sniffs. */
const HLS_PLAYLIST_MAGIC = Buffer.from("#EXTM3U", "latin1");

const SUBTITLE_ROUTE = /^\/g\/([0-9a-f]{32})\/sub\/(\d+)$/;
const FETCH_ROUTE = /^\/g\/([0-9a-f]{32})\/f\/([A-Za-z0-9_-]+=*)$/;
const MEDIA_ROUTE = /^\/g\/([0-9a-f]{32})\/media$/;
const DOC_ROUTE = /^\/g\/([0-9a-f]{32})\/doc$/;
const DASH_ROUTE = /^\/g\/([0-9a-f]{32})\/dash\/(\d{1,4})(?:\/(.*))?$/;

export type GatewayHeaders = Readonly<Record<string, string>>;

/**
 * Timer injection without `unknown`: `schedule` returns the cancel thunk, so
 * a test can capture the idle callback and fire it without sleeping.
 */
type GatewayTimers = {
  readonly schedule: (callback: () => void, ms: number) => () => void;
};

export type StreamGatewayDocument = {
  /** Generated manifest text (DASH MPD for deferred AllManga-Ak locators). */
  readonly text: string;
  readonly contentType: string;
  /** Remote URLs the document references; their origins are allowlisted. */
  readonly remoteUrls: readonly string[];
};

export type RegisterGatewaySessionInput = {
  /** Direct stream URL for `/media`; omit when `document` is the entry. */
  readonly url?: string;
  /** Provider-attached headers, normalized before they ever reach a fetch. */
  readonly headers: Readonly<Record<string, string>>;
  /** External subtitle URLs the player should be offered. */
  readonly subtitles?: readonly string[];
  /** In-memory manifest document served at `/doc` instead of `/media`. */
  readonly document?: StreamGatewayDocument;
};

export type GatewaySession = {
  readonly mediaUrl: string;
  readonly subtitleUrls: readonly string[];
  readonly stop: () => void;
};

type LiveSession = {
  readonly token: string;
  readonly url?: string;
  readonly headers: Headers;
  readonly subtitles: readonly string[];
  readonly document?: StreamGatewayDocument;
  readonly allowedOrigins: Set<string>;
  readonly dashTemplates: Map<string, DashTemplate>;
  readonly dashTemplateIds: Map<string, string>;
};

export type StreamGatewayOptions = {
  /** Injected for tests; the platform fetch gets DNS re-validation per hop. */
  readonly fetchImpl?: StreamReachabilityFetch;
  /** Injected for tests — a fake scheduler lets idle shutdown be asserted
   *  without real sleeps. */
  readonly timers?: GatewayTimers;
  readonly idleTimeoutMs?: number;
};

export type StreamGateway = {
  readonly baseUrl: string;
  readonly isStopped: () => boolean;
  readonly registerSession: (input: RegisterGatewaySessionInput) => GatewaySession;
  readonly stop: () => void;
};

/**
 * `normalizeStreamHttpHeaders` returns referer/user-agent/origin as fields and
 * everything else as `Name: Value` strings for mpv's header list. For fetch we
 * need the inverse fold, so extraFields are split back on their first colon —
 * normalize already rejected names outside the RFC 7230 token set.
 */
function toFetchHeaders(normalized: NormalizedStreamHttpHeaders): Headers {
  const headers = new Headers();
  if (normalized.referer) headers.set("referer", normalized.referer);
  if (normalized.userAgent) headers.set("user-agent", normalized.userAgent);
  if (normalized.origin) headers.set("origin", normalized.origin);
  for (const field of normalized.extraFields) {
    const colon = field.indexOf(":");
    if (colon <= 0) continue;
    const name = field.slice(0, colon).trim().toLowerCase();
    const value = field.slice(colon + 1).trim();
    if (name && value) headers.set(name, value);
  }
  return headers;
}

function mintToken(): string {
  return crypto.getRandomValues(new Uint8Array(16)).toHex();
}

function upstreamGatewayUrl(baseUrl: string, token: string, fullUrl: string): string {
  return `${baseUrl}/g/${token}/f/${toB64Url(Buffer.from(fullUrl))}`;
}

/**
 * Rewrite an HLS playlist so every media/key/map URI flows through `/f/`.
 * Blocked URIs point at a local 404 route. Leaving them literal would let the
 * external player bypass the gateway and fetch a private address itself.
 */
export function rewritePlaylistForGateway(
  text: string,
  baseUrl: string,
  baseGateway: string,
  token: string,
  allowedOrigins: Set<string>,
): string {
  const rewrite = (uri: string): string => {
    const full = resolveHlsSegmentUrl(baseUrl, uri);
    if (blockedLiteralTargetReason(full) !== null) return `${baseGateway}/g/${token}/blocked`;
    let origin: string;
    try {
      origin = new URL(full).origin;
    } catch {
      return `${baseGateway}/g/${token}/blocked`;
    }
    allowedOrigins.add(origin);
    return upstreamGatewayUrl(baseGateway, token, full);
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        if (!/URI="/i.test(t)) return line;
        return line.replace(
          /URI="([^"]+)"/gi,
          (_m: string, uri: string) => `URI="${rewrite(uri)}"`,
        );
      }
      return rewrite(t);
    })
    .join("\n");
}

/** Rewrite DASH addressing through guarded static or registered template routes. */
export function rewriteDocumentForGateway(
  text: string,
  baseGateway: string,
  token: string,
  allowedOrigins: Set<string>,
  options?: {
    readonly manifestUrl?: string;
    readonly registerTemplate: (template: DashTemplate) => string;
  },
): string {
  return rewriteDashManifest({
    text,
    manifestUrl: options?.manifestUrl,
    rewriteUrl(url) {
      if (blockedLiteralTargetReason(url) !== null) return `${baseGateway}/g/${token}/blocked`;
      const template = parseDashTemplate(url);
      allowedOrigins.add(new URL(url).origin);
      if (template.variables.length > 0) {
        if (!options) throw new UnsupportedDashManifestError();
        return options.registerTemplate(template);
      }
      return upstreamGatewayUrl(baseGateway, token, url.replaceAll("$$", "$"));
    },
  });
}

/** Headers a media consumer may legitimately forward: range requests for seeking. */
function passthroughRequestHeaders(req: Request): Headers {
  const out = new Headers();
  for (const name of ["range", "if-range"]) {
    const value = req.headers.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

/** Response headers the player needs for seeking and content handling. */
function passthroughResponseHeaders(upstream: Response, contentType?: string): Headers {
  const out = new Headers();
  const keep = ["content-length", "accept-ranges", "content-range", "etag", "last-modified"];
  for (const name of keep) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set(
    "content-type",
    contentType ?? upstream.headers.get("content-type") ?? "application/octet-stream",
  );
  return out;
}

export function createStreamGateway(options: StreamGatewayOptions = {}): StreamGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timers: GatewayTimers = options.timers ?? {
    schedule: (cb, ms) => {
      const handle = setTimeout(cb, ms);
      return () => clearTimeout(handle);
    },
  };
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  const sessions = new Map<string, LiveSession>();
  let stopped = false;
  let cancelIdle: (() => void) | null = null;
  let activeRequests = 0;
  let activeBodies = 0;

  const resetIdle = () => {
    if (stopped) return;
    cancelIdle?.();
    cancelIdle = timers.schedule(() => {
      cancelIdle = null;
      if (activeRequests === 0 && activeBodies === 0) stop();
    }, idleTimeoutMs);
  };

  function keepAlive(response: Response): Response {
    if (!response.body) return response;
    const reader = response.body.getReader();
    activeBodies++;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      reader.releaseLock();
      activeBodies--;
      resetIdle();
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finish();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  }

  type UpstreamResult =
    | { readonly kind: "response"; readonly response: Response; readonly finalUrl: string }
    | { readonly kind: "refused" | "timeout" };

  function documentOptions(session: LiveSession, baseGateway: string, manifestUrl?: string) {
    return {
      manifestUrl,
      registerTemplate(template: DashTemplate) {
        const existing = session.dashTemplateIds.get(template.url);
        if (existing) return templateUrl(existing, template);
        if (session.dashTemplates.size >= 1024) throw new UnsupportedDashManifestError();
        const id = String(session.dashTemplates.size + 1);
        session.dashTemplates.set(id, template);
        session.dashTemplateIds.set(template.url, id);
        return templateUrl(id, template);
      },
    };
    function templateUrl(id: string, template: DashTemplate) {
      return `${baseGateway}/g/${session.token}/dash/${id}${template.variables.map((variable) => `/${variable.token}`).join("")}`;
    }
  }

  async function upstreamFetch(
    session: LiveSession,
    url: string,
    extra: Headers,
    signal?: AbortSignal,
  ): Promise<UpstreamResult> {
    const blocked = blockedLiteralTargetReason(url);
    if (blocked) return { kind: "refused" };
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return { kind: "refused" };
    }
    if (!session.allowedOrigins.has(origin)) {
      return { kind: "refused" };
    }
    const headers = new Headers(session.headers);
    extra.forEach((value, name) => headers.set(name, value));
    const outcome = await fetchGuardedStreamTarget({
      fetchImpl,
      url,
      init: { headers },
      signal,
    });
    if (outcome.kind === "blocked") return { kind: "refused" };
    if (outcome.kind === "timeout") return { kind: "timeout" };
    return { kind: "response", response: outcome.response, finalUrl: outcome.finalUrl };
  }

  function refusedOrTimeout(result: UpstreamResult): Response {
    return result.kind === "refused"
      ? new Response("upstream refused", { status: 403 })
      : new Response("upstream timeout", { status: 504 });
  }

  /** Read the rest of an already-peeked body, bounded — for the playlist path. */
  async function readRestFromReader(
    reader: {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
      cancel: (reason?: string) => Promise<void> | void;
    },
    firstChunk: Buffer | null,
    cap: number,
  ): Promise<Buffer> {
    const chunks: Uint8Array[] = firstChunk ? [new Uint8Array(firstChunk)] : [];
    let total = firstChunk?.byteLength ?? 0;
    if (total > cap) {
      await Promise.resolve(reader.cancel("over-cap")).catch(() => {});
      throw new Error("upstream body exceeded playlist cap");
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > cap) {
        await Promise.resolve(reader.cancel("over-cap")).catch(() => {});
        throw new Error("upstream body exceeded playlist cap");
      }
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }

  /**
   * Serve one upstream media response.
   *
   * Playlist vs passthrough is decided by the URL hint or the content-type
   * (mpegurl/dash+xml), then by peeking the FIRST chunk for `#EXTM3U` — a
   * playlist served as application/octet-stream from a URL without .m3u8 is
   * still rewritten, and a multi-megabyte MP4 never buffers. A non-playlist
   * body streams: the peeked chunk re-emits ahead of the untouched remainder.
   */
  async function serveUpstreamMedia(
    session: LiveSession,
    result: Extract<UpstreamResult, { kind: "response" }>,
    baseGateway: string,
  ): Promise<Response> {
    const upstream = result.response;
    const finalUrl = result.finalUrl;
    const status = upstream.status;
    const headers = passthroughResponseHeaders(upstream);
    const contentType = upstream.headers.get("content-type") ?? "";
    const hlsHint = isHlsPlaylistUrl(finalUrl) || /mpegurl/i.test(contentType);
    let dashHint = /\.mpd(?:[?#]|$)/i.test(finalUrl) || /dash\+xml/i.test(contentType);

    if (!upstream.body) return new Response(null, { status, headers });

    const reader = upstream.body.getReader();
    let first: { done: boolean; value?: Uint8Array };
    try {
      first = await reader.read();
    } catch (error) {
      reader.releaseLock();
      throw error;
    }
    let head = first.done || !first.value ? null : Buffer.from(first.value);
    let sniffed = head ? classifyManifestPrefix(head.subarray(0, MAX_SNIFF_BYTES)) : "media";
    if (!dashHint && !hlsHint) {
      try {
        while (sniffed === "incomplete" && !first.done) {
          if ((head?.byteLength ?? 0) >= MAX_SNIFF_BYTES) throw new UnsupportedDashManifestError();
          first = await reader.read();
          if (first.done) break;
          if (first.value)
            head = head ? Buffer.concat([head, first.value]) : Buffer.from(first.value);
          sniffed = head ? classifyManifestPrefix(head.subarray(0, MAX_SNIFF_BYTES)) : "media";
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        throw error;
      }
      if (sniffed === "incomplete") {
        // EOF without a complete manifest marker is opaque data. A valid
        // one-byte range can be whitespace or '<'; preserve its bytes/status.
        sniffed = "media";
      }
      dashHint = sniffed === "dash";
    }

    // Progressive bytes pass through as soon as their prefix rules out a
    // manifest. Only an ambiguous text prefix waits for another bounded read.
    const sniffedPlaylist = !dashHint && !hlsHint && sniffed === "hls";

    if (!dashHint && !hlsHint && !sniffedPlaylist) {
      // Binary or text passthrough: re-emit the peeked chunk, then stream.
      const peeked = head;
      const streamed = new ReadableStream<Uint8Array>({
        start(controller) {
          if (peeked) controller.enqueue(new Uint8Array(peeked));
        },
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
            } else if (value) {
              controller.enqueue(value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel() {
          void reader.cancel().catch(() => {});
        },
      });
      return new Response(streamed, { status, headers });
    }

    let full: Buffer;
    try {
      full = await readRestFromReader(reader, head, MAX_PLAYLIST_BYTES);
    } catch {
      reader.releaseLock();
      return new Response("upstream body too large", { status: 502 });
    }
    reader.releaseLock();

    if (dashHint) {
      const rewritten = rewriteDocumentForGateway(
        full.toString("utf-8"),
        baseGateway,
        session.token,
        session.allowedOrigins,
        documentOptions(session, baseGateway, finalUrl),
      );
      return new Response(rewritten, {
        status: 200,
        headers: { "content-type": "application/dash+xml" },
      });
    }
    if (!looksLikePlaylistHead(full)) {
      // Hinted as a playlist but the bytes say otherwise — hand back what the
      // upstream sent rather than manufacturing a broken manifest.
      return new Response(full, { status, headers });
    }
    const rewritten = rewritePlaylistForGateway(
      full.toString("utf-8"),
      finalUrl,
      baseGateway,
      session.token,
      session.allowedOrigins,
    );
    return new Response(rewritten, {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  }

  async function handleRequest(req: Request): Promise<Response> {
    if (stopped) return new Response("gateway stopped", { status: 503 });
    const path = new URL(req.url).pathname;
    const baseGateway = `http://127.0.0.1:${server.port}`;

    const match =
      path.match(MEDIA_ROUTE) ??
      path.match(FETCH_ROUTE) ??
      path.match(SUBTITLE_ROUTE) ??
      path.match(DASH_ROUTE) ??
      path.match(DOC_ROUTE);
    // The same 404 whether the path is unknown or the token is wrong: a
    // probe must never learn whether a token exists.
    if (!match) return new Response("not found", { status: 404 });
    const session = sessions.get(match[1] ?? "");
    if (!session) return new Response("not found", { status: 404 });

    try {
      if (DOC_ROUTE.test(path)) {
        if (!session.document) return new Response("not found", { status: 404 });
        const rewritten = rewriteDocumentForGateway(
          session.document.text,
          baseGateway,
          session.token,
          session.allowedOrigins,
          documentOptions(session, baseGateway),
        );
        return new Response(rewritten, {
          headers: { "content-type": session.document.contentType },
        });
      }

      if (DASH_ROUTE.test(path)) {
        const template = session.dashTemplates.get(match[2] ?? "");
        if (!template) return new Response("not found", { status: 404 });
        let values: string[];
        try {
          values = match[3] ? match[3].split("/").map(decodeURIComponent) : [];
        } catch {
          return new Response("not found", { status: 404 });
        }
        const url = substituteDashTemplate(template, values);
        if (!url) return new Response("upstream refused", { status: 403 });
        const upstream = await upstreamFetch(
          session,
          url,
          passthroughRequestHeaders(req),
          req.signal,
        );
        if (upstream.kind !== "response") return refusedOrTimeout(upstream);
        return await serveUpstreamMedia(session, upstream, baseGateway);
      }

      if (SUBTITLE_ROUTE.test(path)) {
        const index = Number(match[2]);
        const url = session.subtitles[index];
        if (!url) return new Response("not found", { status: 404 });
        const upstream = await upstreamFetch(session, url, new Headers(), req.signal);
        if (upstream.kind !== "response") return refusedOrTimeout(upstream);
        return new Response(upstream.response.body, {
          status: upstream.response.status,
          headers: passthroughResponseHeaders(upstream.response),
        });
      }

      if (FETCH_ROUTE.test(path)) {
        let url: string;
        try {
          const parsed = new URL(fromB64Url(match[2] ?? ""));
          url = parsed.href;
        } catch {
          return new Response("not found", { status: 404 });
        }
        const upstream = await upstreamFetch(
          session,
          url,
          passthroughRequestHeaders(req),
          req.signal,
        );
        if (upstream.kind !== "response") return refusedOrTimeout(upstream);
        return await serveUpstreamMedia(session, upstream, baseGateway);
      }

      // /media — the registered entry URL.
      if (!session.url) return new Response("not found", { status: 404 });
      const upstream = await upstreamFetch(
        session,
        session.url,
        passthroughRequestHeaders(req),
        req.signal,
      );
      if (upstream.kind !== "response") return refusedOrTimeout(upstream);
      return await serveUpstreamMedia(session, upstream, baseGateway);
    } catch (error) {
      if (error instanceof UnsupportedDashManifestError)
        return new Response("unsupported DASH manifest", { status: 422 });
      // Never leak upstream error text (it can carry the private URL)
      // into a response the player surfaces.
      return new Response("upstream fetch failed", { status: 502 });
    }
  }

  const server: Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      activeRequests++;
      resetIdle();
      try {
        return keepAlive(await handleRequest(req));
      } finally {
        activeRequests--;
        resetIdle();
      }
    },
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelIdle?.();
    cancelIdle = null;
    sessions.clear();
    server.stop(true);
  }

  const gateway: StreamGateway = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    isStopped: () => stopped,
    registerSession(input) {
      if (stopped) throw new Error("stream gateway is stopped");
      // One playback at a time: a new handoff revokes every prior token so a
      // stale player cannot keep pulling streams after the user moved on.
      sessions.clear();
      const token = mintToken();
      const normalized = normalizeStreamHttpHeaders({ ...input.headers });
      const allowedOrigins = new Set<string>();
      const addOrigin = (raw: string) => {
        try {
          const parsed = new URL(raw);
          if (blockedLiteralTargetReason(raw) === null) allowedOrigins.add(parsed.origin);
        } catch {
          // Non-URL entries never join the allowlist.
        }
      };
      if (input.url) addOrigin(input.url);
      const subtitles = (input.subtitles ?? []).filter((subtitle) => {
        addOrigin(subtitle);
        try {
          const parsed = new URL(subtitle);
          return (
            blockedLiteralTargetReason(subtitle) === null && parsed.protocol.startsWith("http")
          );
        } catch {
          return false;
        }
      });
      for (const remote of input.document?.remoteUrls ?? []) addOrigin(remote);
      const session: LiveSession = {
        token,
        url: input.url,
        headers: toFetchHeaders(normalized),
        subtitles,
        document: input.document,
        allowedOrigins,
        dashTemplates: new Map(),
        dashTemplateIds: new Map(),
      };
      sessions.set(token, session);
      const base = gateway.baseUrl;
      return {
        mediaUrl: input.document ? `${base}/g/${token}/doc` : `${base}/g/${token}/media`,
        subtitleUrls: subtitles.map((_, i) => `${base}/g/${token}/sub/${i}`),
        stop,
      };
    },
    stop,
  };

  resetIdle();
  return gateway;
}

/**
 * The process-wide gateway. Playback handoff owns it: one instance serves every
 * session, and registering a new session revokes earlier tokens.
 */
let sharedGateway: StreamGateway | null = null;

export function getSharedStreamGateway(options?: StreamGatewayOptions): StreamGateway {
  if (sharedGateway && !sharedGateway.isStopped()) return sharedGateway;
  sharedGateway = createStreamGateway(options);
  return sharedGateway;
}

/** Test and shutdown hook — real lifetime is owned by the handoff caller. */
export function stopSharedStreamGateway(): void {
  sharedGateway?.stop();
  sharedGateway = null;
}
