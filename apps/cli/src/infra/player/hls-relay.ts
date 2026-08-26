import { spawn } from "node:child_process";

import { isHlsPlaylistUrl, resolveHlsSegmentUrl } from "@kunai/core";
import type { Server } from "bun";

import { normalizeStreamHttpHeaders } from "./mpv-stream-http-headers";

/**
 * Exact upstream CDN apexes. Their real subdomains are allowed; sibling TLDs
 * and lookalike suffixes are not.
 *
 * These were `/\.uwucdn\./i` and `/\.owocdn\./i` — unanchored substring tests
 * against the hostname, so `evil.uwucdn.attacker.com` matched and the relay
 * would fetch it. A later registrable-domain-shaped regex still accepted any
 * attacker-registrable TLD, such as `uwucdn.com`. `assertRelayUpstreamUrl` is
 * the only gate on what this server will request, and it is applied to
 * attacker-influenceable input: the base64 path segments on `/p/` and `/s/`,
 * and every URI rewritten out of a provider-supplied playlist.
 */
const CDN_APEX_HOSTNAMES = ["uwucdn.top", "owocdn.top"] as const;

/** `#EXTM3U`, as bytes — a playlist is identified without decoding the body. */
const HLS_PLAYLIST_MAGIC = Buffer.from("#EXTM3U", "latin1");

/**
 * Is this response an HLS playlist?
 *
 * Both handlers used to answer this with `body.toString("utf-8").startsWith(…)`,
 * which decodes the entire response to test seven bytes. For a binary MPEG-TS
 * segment that is the worst case: the bytes are not valid UTF-8, so V8 builds a
 * two-byte string and runs replacement-character substitution over several
 * megabytes, every segment, to answer a question about the first seven.
 */
export function looksLikeHlsPlaylist(body: Buffer): boolean {
  return body.subarray(0, HLS_PLAYLIST_MAGIC.length).equals(HLS_PLAYLIST_MAGIC);
}
/** Safety-net only; playback owns stop() for the real lifetime. */
const IDLE_TIMEOUT_MS = 15 * 60_000;
const CURL_META_MARKER = "__KUNAI_CURL_META__";
/**
 * Upstream responses are buffered whole before being served back. Segments are
 * single HLS chunks, but a hostile or misbehaving allowlisted CDN could stream
 * forever — bound the buffer and kill the fetch instead of growing the heap.
 */
const MAX_UPSTREAM_BODY_BYTES = 64 * 1024 * 1024;
const MAX_CURL_STDERR_CHARS = 8_192;

/**
 * Backstop deadline for the whole curl invocation, above curl's own
 * `--max-time 25` so curl reports its error first in the normal case. This only
 * fires when curl cannot report at all — stopped, or never exec'd.
 */
const CURL_WATCHDOG_MS = 30_000;

const AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Check if a stream URL needs the curl-based HLS relay (CDN blocks mpv TLS). */
export function streamNeedsHlsRelay(url: string): boolean {
  try {
    return isHlsRelayUpstreamHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isHlsRelayUpstreamHost(hostname: string): boolean {
  return CDN_APEX_HOSTNAMES.some((apex) => hostname === apex || hostname.endsWith(`.${apex}`));
}

function assertRelayUpstreamUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid upstream URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("upstream URL must be http(s)");
  }
  if (!isHlsRelayUpstreamHost(parsed.hostname)) {
    throw new Error(`upstream host not allowlisted for HLS relay: ${parsed.hostname}`);
  }
  return parsed;
}

export type HlsRelayCurlResponse = {
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
  readonly redirectUrl: string | null;
  /** Complete curl stdout, including the fixed metadata trailer. */
  readonly receivedBytes?: number;
};

export type HlsRelayCurlBudget = {
  readonly maxResponseBytes: number;
  readonly bodyLimitBytes: number;
  readonly curlTimeoutMs: number;
  readonly watchdogTimeoutMs: number;
};

export type HlsRelayCurlRequest = (
  url: string,
  budget: HlsRelayCurlBudget,
) => Promise<HlsRelayCurlResponse>;

export type HlsRelayFetchOptions = {
  readonly now?: () => number;
  readonly maxResponseBytes?: number;
  readonly curlTimeoutMs?: number;
  readonly watchdogTimeoutMs?: number;
};

export type HlsRelayUpstreamResponse = HlsRelayCurlResponse & {
  readonly effectiveUrl: string;
};

export async function fetchHlsRelayUpstream(
  url: string,
  request: HlsRelayCurlRequest,
  options: HlsRelayFetchOptions = {},
): Promise<HlsRelayUpstreamResponse> {
  // Redirect-chain budgets are elapsed-time limits. A wall-clock correction
  // must not restore time to later hops, so production uses a monotonic clock.
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const bodyLimitBytes = options.maxResponseBytes ?? MAX_UPSTREAM_BODY_BYTES;
  const curlTimeoutMs = options.curlTimeoutMs ?? 25_000;
  const watchdogTimeoutMs = options.watchdogTimeoutMs ?? CURL_WATCHDOG_MS;
  let remainingResponseBytes = bodyLimitBytes;

  const remainingMs = (limitMs: number) => Math.max(0, limitMs - Math.max(0, now() - startedAt));
  const assertWithinDeadline = () => {
    if (remainingMs(curlTimeoutMs) <= 0) {
      throw new Error(`upstream redirect chain exceeded ${curlTimeoutMs}ms`);
    }
  };

  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    assertWithinDeadline();
    const current = assertRelayUpstreamUrl(currentUrl);
    const response = await request(current.href, {
      maxResponseBytes: remainingResponseBytes,
      bodyLimitBytes,
      curlTimeoutMs: remainingMs(curlTimeoutMs),
      watchdogTimeoutMs: remainingMs(watchdogTimeoutMs),
    });
    const receivedBytes = response.receivedBytes ?? response.body.length;
    if (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0) {
      throw new Error("upstream response reported an invalid byte count");
    }
    if (receivedBytes > remainingResponseBytes) {
      throw new Error(`upstream body exceeded ${bodyLimitBytes} bytes`);
    }
    remainingResponseBytes -= receivedBytes;
    assertWithinDeadline();
    if (response.status < 300 || response.status >= 400 || !response.redirectUrl) {
      return { ...response, effectiveUrl: current.href };
    }
    if (redirectCount === 3) {
      throw new Error("upstream redirected too many times");
    }
    const redirect = assertRelayUpstreamUrl(new URL(response.redirectUrl, current).href);
    if (current.protocol === "https:" && redirect.protocol === "http:") {
      throw new Error("HTTPS upstream cannot redirect to HTTP");
    }
    currentUrl = redirect.href;
  }
  throw new Error("upstream redirected too many times");
}

export function buildHlsRelayCurlArgs(
  url: string,
  referer: string,
  origin: string,
  budget: HlsRelayCurlBudget,
): string[] {
  return [
    // curl only honors --disable/-q as a config-file guard when it is the first
    // argument. Without it, a user's `location` setting can follow a redirect
    // before Kunai validates the next hop.
    "-q",
    "-sS",
    "--no-location",
    "--http2",
    "-A",
    AGENT,
    "-H",
    `Referer: ${referer}`,
    "-H",
    `Origin: ${origin}`,
    "-H",
    "Accept: */*",
    "--max-time",
    (Math.max(1, budget.curlTimeoutMs) / 1_000).toFixed(3),
    "-w",
    `\n${CURL_META_MARKER}%{http_code}\n%{content_type}\n%{redirect_url}`,
    "--",
    url,
  ];
}

function curlFetchOnce(
  url: string,
  referer: string,
  origin: string,
  budget: HlsRelayCurlBudget,
): Promise<HlsRelayCurlResponse> {
  assertRelayUpstreamUrl(url);
  return new Promise((resolve, reject) => {
    const proc = spawn("curl", buildHlsRelayCurlArgs(url, referer, origin, budget));
    let chunks: Buffer[] = [];
    let totalBytes = 0;
    let stderr = "";
    let settled = false;

    // Nothing may settle twice, and the child must never outlive the promise.
    const finish = (outcome: () => void, kill: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (kill) proc.kill("SIGKILL");
      outcome();
    };
    const fail = (error: Error, kill = true) => finish(() => reject(error), kill);

    // curl's own `--max-time` is the normal deadline, but it only fires if curl
    // is running: a stopped process, or a shim that never execs curl, leaves
    // this promise pending forever and the request handler awaiting it. This is
    // the backstop, deliberately above curl's own limit so curl reports first.
    const watchdog = setTimeout(
      () => {
        fail(new Error(`curl did not exit within ${budget.watchdogTimeoutMs}ms`));
      },
      Math.max(1, budget.watchdogTimeoutMs),
    );

    proc.stdout.on("data", (d: Buffer) => {
      if (settled) return;
      totalBytes += d.length;
      if (totalBytes > budget.maxResponseBytes) {
        // Drop the buffered body before rejecting; holding 64 MiB until the
        // rejection unwinds is the opposite of what the cap is for.
        chunks = [];
        fail(new Error(`upstream body exceeded ${budget.bodyLimitBytes} bytes`));
        return;
      }
      chunks.push(d);
    });
    proc.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_CURL_STDERR_CHARS) stderr += d.toString();
    });
    // An EventEmitter 'error' with no listener is an *uncaught exception*, not a
    // rejected promise — a pipe error (EPIPE/EIO, most likely right after the
    // SIGKILL above) would take the whole CLI down mid-playback.
    proc.stdout.on("error", (error: Error) => fail(error));
    proc.stderr.on("error", (error: Error) => fail(error));
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      const buf = Buffer.concat(chunks);
      if (code !== 0 && buf.length === 0) {
        reject(new Error(`curl exit ${code}: ${stderr.slice(0, 120)}`));
        return;
      }
      // Find the trailer in the bytes. This used to decode the whole response
      // to a latin1 string, slice it, and re-encode the slice into a new
      // Buffer — three full-size allocations per response, on a path that
      // carries multi-megabyte video segments. `Buffer.lastIndexOf` and
      // `subarray` do the same work with no copies at all: `subarray` is a view
      // over the existing memory, not a duplicate.
      const marker = Buffer.from(`\n${CURL_META_MARKER}`, "latin1");
      const metaAt = buf.lastIndexOf(marker);
      if (metaAt === -1) {
        reject(new Error("curl response missing status trailer"));
        return;
      }
      const body = buf.subarray(0, metaAt);
      // Only the trailer becomes a string; it is a status code and a MIME type.
      const metaLines = buf
        .subarray(metaAt + marker.length)
        .toString("utf-8")
        .split("\n");
      const status = Number.parseInt(metaLines[0] ?? "0", 10);
      const contentType =
        (metaLines[1] ?? "application/octet-stream").split(";")[0]?.trim() ||
        "application/octet-stream";
      const redirectUrl = metaLines[2]?.trim() || null;
      if (!Number.isFinite(status) || status <= 0) {
        reject(new Error(`curl invalid status trailer: ${metaLines[0] ?? ""}`));
        return;
      }
      resolve({ status, contentType, body, redirectUrl, receivedBytes: buf.length });
    });
    // Spawn failure (curl missing, ENOMEM): there is no process to kill.
    proc.on("error", (err: Error) => fail(err, false));
  });
}

function curlFetch(
  url: string,
  referer: string,
  origin: string,
): Promise<HlsRelayUpstreamResponse> {
  return fetchHlsRelayUpstream(url, (currentUrl, budget) =>
    curlFetchOnce(currentUrl, referer, origin, budget),
  );
}

export function toB64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(raw: string): string {
  const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64").toString("utf8");
}

function relayPathForUpstream(fullUrl: string, relayOrigin: string): string {
  const b64 = toB64Url(Buffer.from(fullUrl));
  if (isHlsPlaylistUrl(fullUrl)) {
    return `${relayOrigin}/p/${b64}.m3u8`;
  }
  return `${relayOrigin}/s/${b64}`;
}

/** Rewrite an HLS playlist so every media/URI target is fetched through the local relay. */
export function rewriteHlsPlaylistForRelay(
  text: string,
  baseUrl: string,
  relayOrigin: string,
): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        if (!/URI="/i.test(t)) return line;
        return line.replace(/URI="([^"]+)"/gi, (_m: string, uri: string) => {
          const full = resolveHlsSegmentUrl(baseUrl, uri);
          assertRelayUpstreamUrl(full);
          return `URI="${relayPathForUpstream(full, relayOrigin)}"`;
        });
      }
      const full = resolveHlsSegmentUrl(baseUrl, t);
      assertRelayUpstreamUrl(full);
      return relayPathForUpstream(full, relayOrigin);
    })
    .join("\n");
}

export type HlsRelayStopReason = "playback-end" | "session-release" | "idle" | "error";

export interface HlsRelayHandle {
  readonly proxyUrl: string;
  readonly upstreamHost: string;
  readonly stop: (reason?: HlsRelayStopReason) => void;
}

export type StartHlsRelayOptions = {
  readonly onStopped?: (reason: HlsRelayStopReason) => void;
  readonly onUpstreamError?: (info: {
    readonly status?: number;
    readonly host: string;
    readonly message: string;
  }) => void;
};

/**
 * Start a curl-based HLS relay for CDNs that block mpv/ffmpeg TLS fingerprints.
 * The relay serves the HLS playlist and proxies segments/keys through curl.
 * Callers own lifetime via stop(); idle auto-stop is a long safety net only.
 */
export function startHlsRelay(
  originalUrl: string,
  streamHeaders: Readonly<Record<string, string>>,
  options: StartHlsRelayOptions = {},
): HlsRelayHandle {
  if (!Bun.which("curl")) {
    throw new Error("curl is required for HLS relay (CDN blocks non-curl TLS fingerprints)");
  }

  const upstream = assertRelayUpstreamUrl(originalUrl);
  // Same normalization the mpv path uses: case-insensitive lookup plus CR/LF
  // stripping, so provider-supplied values can't smuggle extra curl headers.
  const normalized = normalizeStreamHttpHeaders(streamHeaders);
  const referer = normalized.referer ?? "https://kwik.cx/";
  const origin = normalized.origin ?? new URL(referer).origin;
  const playlistB64 = toB64Url(Buffer.from(originalUrl));

  let idleTimer: Timer | null = null;
  let stopped = false;
  let closeRelay: ((reason: HlsRelayStopReason) => void) | null = null;

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    const closer = closeRelay;
    if (!closer || stopped) return;
    idleTimer = setTimeout(() => closer("idle"), IDLE_TIMEOUT_MS);
  }

  const server: Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (stopped) {
        return new Response("relay stopped", { status: 503 });
      }
      resetIdleTimer();
      const path = new URL(req.url).pathname;
      const relayOrigin = `http://127.0.0.1:${server.port}`;

      if (path.startsWith("/p/")) {
        const rawB64 = path.slice(3).replace(/\.m3u8$/i, "");
        let srcUrl: string;
        try {
          srcUrl = fromB64Url(rawB64);
          assertRelayUpstreamUrl(srcUrl);
        } catch {
          // Body stays generic on purpose: the exception text can carry the
          // upstream URL, and this response crosses a process boundary.
          return new Response("invalid upstream URL", { status: 403 });
        }
        try {
          const r = await curlFetch(srcUrl, referer, origin);
          if (r.status !== 200) {
            options.onUpstreamError?.({
              status: r.status,
              host: new URL(r.effectiveUrl).hostname,
              message: `upstream ${r.status}`,
            });
            return new Response(`upstream ${r.status}`, { status: r.status });
          }
          if (looksLikeHlsPlaylist(r.body)) {
            const rewritten = rewriteHlsPlaylistForRelay(
              r.body.toString("utf-8"),
              r.effectiveUrl,
              relayOrigin,
            );
            return new Response(rewritten, {
              headers: { "Content-Type": "application/vnd.apple.mpegurl" },
            });
          }
          return new Response(r.body, {
            headers: { "Content-Type": r.contentType },
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          options.onUpstreamError?.({
            host: new URL(srcUrl).hostname,
            message,
          });
          return new Response("upstream fetch failed", { status: 502 });
        }
      }

      if (path.startsWith("/s/")) {
        let srcUrl: string;
        try {
          srcUrl = fromB64Url(path.slice(3));
          assertRelayUpstreamUrl(srcUrl);
        } catch {
          // See above: never echo exception text into a relay response body.
          return new Response("invalid upstream URL", { status: 403 });
        }
        try {
          const r = await curlFetch(srcUrl, referer, origin);
          if (r.status !== 200) {
            options.onUpstreamError?.({
              status: r.status,
              host: new URL(r.effectiveUrl).hostname,
              message: `upstream ${r.status}`,
            });
          }
          // A variant playlist can arrive on the segment route when the URL did
          // not look like a playlist, so the check stays — but on bytes.
          if (r.status === 200 && looksLikeHlsPlaylist(r.body)) {
            const rewritten = rewriteHlsPlaylistForRelay(
              r.body.toString("utf-8"),
              r.effectiveUrl,
              relayOrigin,
            );
            return new Response(rewritten, {
              headers: { "Content-Type": "application/vnd.apple.mpegurl" },
            });
          }
          return new Response(r.body, {
            headers: { "Content-Type": r.contentType },
            status: r.status,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          options.onUpstreamError?.({
            host: new URL(srcUrl).hostname,
            message,
          });
          return new Response("upstream fetch failed", { status: 502 });
        }
      }

      return new Response("use /p/<b64url>.m3u8 or /s/<b64url>", { status: 404 });
    },
  });

  const proxyUrl = `http://127.0.0.1:${server.port}/p/${playlistB64}.m3u8`;

  const stop = (reason: HlsRelayStopReason = "playback-end") => {
    if (stopped) return;
    stopped = true;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    server.stop(true);
    options.onStopped?.(reason);
  };

  closeRelay = stop;
  resetIdleTimer();

  return { proxyUrl, upstreamHost: upstream.hostname, stop };
}
