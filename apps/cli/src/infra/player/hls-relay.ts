import { spawn } from "node:child_process";

import type { Server } from "bun";

const CDN_PATTERNS = [/\.uwucdn\./i, /\.owocdn\./i] as const;
const IDLE_TIMEOUT_MS = 60_000;

/** Check if a stream URL needs the curl-based HLS relay (CDN blocks mpv TLS). */
export function streamNeedsHlsRelay(url: string): boolean {
  try {
    return CDN_PATTERNS.some((p) => p.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

const AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function curlFetch(
  url: string,
  referer: string,
  origin: string,
): Promise<{ status: number; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("curl", [
      "-sS",
      "--http2",
      "-L",
      "--max-redirs",
      "3",
      "-D",
      "-",
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
      const sep = buf.indexOf("\r\n\r\n");
      if (sep === -1) {
        reject(new Error("no header/body separator"));
        return;
      }
      const raw = buf.slice(0, sep).toString();
      const status = Number.parseInt(raw.match(/HTTP\/\d+\.?\d*\s+(\d+)/)?.[1] ?? "200", 10);
      const lc = raw.toLowerCase();
      const ct = lc.match(/content-type:\s*(\S+)/i)?.[1] ?? "application/octet-stream";
      resolve({ status, contentType: ct, body: buf.slice(sep + 4) });
    });
    proc.on("error", reject);
  });
}

function toB64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function rewritePlaylist(text: string, baseUrl: string, relayOrigin: string): string {
  const baseDir = baseUrl.replace(/\/[^/]*$/, "/");
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.startsWith("http")) {
        return `${relayOrigin}/s/${toB64Url(Buffer.from(t))}`;
      }
      if (t.startsWith("/")) {
        const full = baseDir.replace(/\/$/, "") + t;
        return `${relayOrigin}/s/${toB64Url(Buffer.from(full))}`;
      }
      if (t.startsWith("#EXT-X-KEY") || t.startsWith("#EXTINF")) {
        return line.replace(/URI="([^"]+)"/g, (_m: string, uri: string) => {
          const full = uri.startsWith("http") ? uri : baseDir + uri;
          return `URI="${relayOrigin}/s/${toB64Url(Buffer.from(full))}"`;
        });
      }
      return line;
    })
    .join("\n");
}

export interface HlsRelayHandle {
  readonly proxyUrl: string;
  readonly stop: () => void;
}

/**
 * Start a curl-based HLS relay for CDNs that block mpv/ffmpeg TLS fingerprints.
 * The relay serves the HLS playlist and proxies segments/keys through curl.
 * Auto-stops after 60s of inactivity.
 */
export function startHlsRelay(
  originalUrl: string,
  streamHeaders: Readonly<Record<string, string>>,
): HlsRelayHandle {
  if (!Bun.which("curl")) {
    throw new Error("curl is required for HLS relay (CDN blocks non-curl TLS fingerprints)");
  }

  const referer = streamHeaders.referer ?? streamHeaders.Referer ?? "https://kwik.cx/";
  const origin = streamHeaders.origin ?? streamHeaders.Origin ?? new URL(referer).origin;
  const playlistB64 = toB64Url(Buffer.from(originalUrl));

  let idleTimer: Timer | null = null;
  let closeRelay: (() => void) | null = null;

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (!closeRelay) return;
    idleTimer = setTimeout(() => closeRelay!(), IDLE_TIMEOUT_MS);
  }

  const server: Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      resetIdleTimer();
      const path = new URL(req.url).pathname;

      if (path.startsWith("/p/")) {
        const rawB64 = path.slice(3).replace(/\.m3u8$/, "");
        const srcUrl = Buffer.from(rawB64, "base64").toString();
        try {
          const r = await curlFetch(srcUrl, referer, origin);
          if (r.status !== 200) {
            return new Response(`upstream ${r.status}`, { status: r.status });
          }
          const body = r.body.toString("utf-8");
          if (body.startsWith("#EXTM3U")) {
            const port = server.port;
            const rewritten = rewritePlaylist(body, srcUrl, `http://127.0.0.1:${port}`);
            return new Response(rewritten, {
              headers: { "Content-Type": "application/vnd.apple.mpegurl" },
            });
          }
          return new Response(r.body, {
            headers: { "Content-Type": r.contentType },
          });
        } catch (err: unknown) {
          return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
        }
      }

      if (path.startsWith("/s/")) {
        const srcUrl = Buffer.from(path.slice(3), "base64").toString();
        try {
          const r = await curlFetch(srcUrl, referer, origin);
          return new Response(r.body, {
            headers: { "Content-Type": r.contentType },
            status: r.status,
          });
        } catch (err: unknown) {
          return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
        }
      }

      return new Response("use /p/<b64url>.m3u8 or /s/<b64url>", { status: 404 });
    },
  });

  const proxyUrl = `http://127.0.0.1:${server.port}/p/${playlistB64}.m3u8`;

  const stop = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    server.stop(true);
  };

  closeRelay = stop;
  resetIdleTimer();

  return { proxyUrl, stop };
}
