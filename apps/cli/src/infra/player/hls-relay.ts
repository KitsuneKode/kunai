import { spawn } from "node:child_process";

import { isHlsPlaylistUrl, resolveHlsSegmentUrl } from "@kunai/core";
import type { Server } from "bun";

const CDN_PATTERNS = [/\.uwucdn\./i, /\.owocdn\./i] as const;
/** Safety-net only; playback owns stop() for the real lifetime. */
const IDLE_TIMEOUT_MS = 15 * 60_000;
const CURL_META_MARKER = "__KUNAI_CURL_META__";

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
  return CDN_PATTERNS.some((p) => p.test(hostname));
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

function curlFetch(
  url: string,
  referer: string,
  origin: string,
): Promise<{ status: number; contentType: string; body: Buffer }> {
  assertRelayUpstreamUrl(url);
  return new Promise((resolve, reject) => {
    const proc = spawn("curl", [
      "-sS",
      "--http2",
      "-L",
      "--max-redirs",
      "3",
      "-A",
      AGENT,
      "-H",
      `Referer: ${referer}`,
      "-H",
      `Origin: ${origin}`,
      "-H",
      "Accept: */*",
      "--max-time",
      "25",
      "-w",
      `\n${CURL_META_MARKER}%{http_code}\n%{content_type}`,
      "--",
      url,
    ]);
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 && buf.length === 0) {
        reject(new Error(`curl exit ${code}: ${stderr.slice(0, 120)}`));
        return;
      }
      const raw = buf.toString("binary");
      const marker = `\n${CURL_META_MARKER}`;
      const metaAt = raw.lastIndexOf(marker);
      if (metaAt === -1) {
        reject(new Error("curl response missing status trailer"));
        return;
      }
      const body = Buffer.from(raw.slice(0, metaAt), "binary");
      const metaLines = raw.slice(metaAt + marker.length).split("\n");
      const status = Number.parseInt(metaLines[0] ?? "0", 10);
      const contentType =
        (metaLines[1] ?? "application/octet-stream").split(";")[0]?.trim() ||
        "application/octet-stream";
      if (!Number.isFinite(status) || status <= 0) {
        reject(new Error(`curl invalid status trailer: ${metaLines[0] ?? ""}`));
        return;
      }
      resolve({ status, contentType, body });
    });
    proc.on("error", reject);
  });
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
  const referer = streamHeaders.referer ?? streamHeaders.Referer ?? "https://kwik.cx/";
  const origin = streamHeaders.origin ?? streamHeaders.Origin ?? new URL(referer).origin;
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
        } catch (err: unknown) {
          return new Response("invalid upstream URL", { status: 403 });
        }
        try {
          const r = await curlFetch(srcUrl, referer, origin);
          if (r.status !== 200) {
            options.onUpstreamError?.({
              status: r.status,
              host: new URL(srcUrl).hostname,
              message: `upstream ${r.status}`,
            });
            return new Response(`upstream ${r.status}`, { status: r.status });
          }
          const body = r.body.toString("utf-8");
          if (body.startsWith("#EXTM3U")) {
            const rewritten = rewriteHlsPlaylistForRelay(body, srcUrl, relayOrigin);
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
        } catch (err: unknown) {
          return new Response("invalid upstream URL", { status: 403 });
        }
        try {
          const r = await curlFetch(srcUrl, referer, origin);
          if (r.status !== 200) {
            options.onUpstreamError?.({
              status: r.status,
              host: new URL(srcUrl).hostname,
              message: `upstream ${r.status}`,
            });
          }
          const bodyText = r.body.toString("utf-8");
          if (r.status === 200 && bodyText.startsWith("#EXTM3U")) {
            const rewritten = rewriteHlsPlaylistForRelay(bodyText, srcUrl, relayOrigin);
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
