// =============================================================================
// poster-source-cache.ts — bounded acquisition of poster source bytes.
//
// Every byte here arrives from somewhere untrusted: a CDN response or a sidecar
// file on disk. Both are read against an explicit ceiling and streamed, so a
// mis-sized or hostile source cannot be pulled wholesale into memory before
// anyone notices how large it is. Content-Length is used as a cheap early
// rejection, never as the only defence — it is attacker-controlled, so the
// stream is bounded independently.
// =============================================================================

import { resolveCatalogPosterUrl } from "@/domain/catalog/resolve-catalog-poster-url";
import { MAX_POSTER_SOURCE_BYTES } from "@/image/native-image";
import { observeOnlineIfBound } from "@/services/network/network-observation";

import { createKeyedInflight } from "./inflight";
import { ByteBudgetLruCache } from "./poster-byte-cache";

export type PosterSource = {
  /** The resolved asset this byte payload came from — the prepared cache keys off it. */
  readonly identity: string;
  readonly bytes: Uint8Array;
};

export const MAX_POSTER_SOURCE_CACHE_ENTRIES = 24;
export const MAX_POSTER_SOURCE_CACHE_BYTES = 48 * 1024 * 1024;

const sourceCache = new ByteBudgetLruCache<string, PosterSource>({
  maxEntries: MAX_POSTER_SOURCE_CACHE_ENTRIES,
  maxBytes: MAX_POSTER_SOURCE_CACHE_BYTES,
  weight: (source) => source.bytes.byteLength,
});
const sourceInflight = createKeyedInflight();

function getTmdbSize(cols: number, variant: "preview" | "detail"): string {
  if (variant === "detail") return cols <= 28 ? "w500" : "w780";
  if (cols <= 18) return "w342";
  if (cols <= 28) return "w500";
  // Never "original": a terminal pane tops out near 40 cells (~400px), so
  // multi-megabyte originals only add fetch latency, decode time, and RAM in
  // the source cache without changing a single output cell.
  return "w780";
}

/**
 * Resolve a catalog poster reference to something fetchable, or null when the
 * URL contract rejects it. The old `?? url` fallback fetched exactly the
 * candidates the validator refuses — `http:`, `data:`, malformed — so the
 * "safe public HTTPS" guarantee was decorative on this path.
 */
export function resolvePosterUrl(
  url: string,
  { cols = 18, variant = "preview" }: { cols?: number; variant?: "preview" | "detail" } = {},
): string | null {
  if (isLocalImagePath(url)) return localPathFromImageRef(url);
  return resolveCatalogPosterUrl(url, { tmdbSize: getTmdbSize(cols, variant) });
}

export function clearPosterSourceCache(): void {
  sourceCache.clear();
  sourceInflight.clear();
}

/**
 * Read a stream into one buffer, refusing to exceed the source ceiling.
 *
 * The cumulative check happens before each chunk is kept, so an undeclared or
 * understated body is cut off at the limit rather than after it. Cancelling the
 * reader is what actually stops the transfer; simply returning would leave the
 * socket draining in the background.
 */
async function readPosterStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const onAbort = () => void reader.cancel("aborted").catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (signal?.aborted) return null;
      total += value.byteLength;
      if (total > MAX_POSTER_SOURCE_BYTES) {
        await reader.cancel("too-large").catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // A dropped connection mid-body is not a cacheable outcome.
    return null;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (signal?.aborted) return null;

  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

async function readLocalPosterSource(
  path: string,
  signal?: AbortSignal,
): Promise<PosterSource | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  // Stat first: a sidecar larger than the ceiling must never be read at all.
  if (file.size > MAX_POSTER_SOURCE_BYTES || file.size === 0) return null;
  const bytes = await readPosterStream(file.stream(), signal);
  if (!bytes || bytes.byteLength === 0) return null;
  return { identity: path, bytes };
}

/**
 * Byte-level image sniff for the decodable set — PNG, JPEG, GIF, WebP (RIFF),
 * AVIF/HEIC (`ftyp` box), BMP, ICO. A 200 response can still be an HTML error
 * page, and without this gate those bytes land in the source cache and fail
 * decode on every subsequent render instead of once.
 */
function hasImageSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true; // JPEG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true; // PNG
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true; // GIF
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true; // BMP
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return true; // ICO
  if (bytes.byteLength >= 12) {
    const tag = String.fromCharCode(...bytes.subarray(4, 8));
    if (tag === "ftyp") return true; // ISO BMFF — AVIF/HEIC
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return true; // RIFF....WEBP
    }
  }
  return false;
}

async function readRemotePosterSource(
  url: string,
  signal?: AbortSignal,
): Promise<PosterSource | null> {
  const timeout = AbortSignal.timeout(5000);
  const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await observeOnlineIfBound("poster-error", () =>
    fetch(url, {
      signal: fetchSignal,
      // Ask for images: negotiating servers then serve bytes we can use (or
      // 406) instead of an HTML error page we would only discard below.
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
    }),
  );
  if (!response.ok || !response.body) {
    // Drain nothing; just let the body go.
    await response.body?.cancel("unused").catch(() => {});
    return null;
  }

  // Posters must be image bytes. An HTML error page (or anything else a
  // provider/CDN URL serves with a declared non-image type) is never worth
  // caching, decoding, or handing to the terminal — the offline artwork cache
  // already enforces this, and the preview path matches it. Absent and
  // generic binary types are still read (bounded below, magic-byte sniffing
  // fails closed downstream) because CDNs omit or mislabel types on genuine
  // images.
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (
    contentType !== undefined &&
    contentType !== "" &&
    !contentType.startsWith("image/") &&
    contentType !== "application/octet-stream" &&
    contentType !== "binary/octet-stream"
  ) {
    await response.body.cancel("non-image").catch(() => {});
    return null;
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_POSTER_SOURCE_BYTES) {
    await response.body.cancel("too-large").catch(() => {});
    return null;
  }

  const bytes = await readPosterStream(response.body, signal);
  if (!bytes || bytes.byteLength === 0 || !hasImageSignature(bytes)) return null;
  return { identity: url, bytes };
}

export async function fetchPosterSource(
  url: string | undefined,
  {
    cols = 18,
    variant = "preview",
    signal,
  }: { cols?: number; variant?: "preview" | "detail"; signal?: AbortSignal } = {},
): Promise<PosterSource | null> {
  if (!url) return null;
  if (signal?.aborted) return null;
  const resolved = resolvePosterUrl(url, { cols, variant });
  if (!resolved) return null;
  const cached = sourceCache.get(resolved);
  if (cached) return cached;

  // The leader reads without any caller's signal so a fast-scrolling abort
  // cannot kill a fetch another surface still needs — and a completed read
  // still warms the cache for the next caller. `signal` gates this caller's
  // own await only.
  return sourceInflight.join(
    resolved,
    async () => {
      try {
        const source = isLocalImagePath(resolved)
          ? await readLocalPosterSource(resolved)
          : await readRemotePosterSource(resolved);
        if (!source) return null;
        // Only a complete, in-bounds read is worth remembering; caching a
        // failure would make one dropped connection permanent for the process.
        sourceCache.set(resolved, source);
        return source;
      } catch {
        return null;
      }
    },
    signal,
  );
}

/**
 * Whether this poster reference is a path on disk rather than a URL to fetch.
 *
 * Windows shapes are load-bearing, not defensive: a downloaded thumbnail is a
 * `C:\\...` path there, and treating it as remote sent it to `fetch()`, which
 * failed silently and left every local poster blank on Windows.
 */
export function isLocalImagePath(url: string): boolean {
  if (url.startsWith("file://")) return true;
  // A protocol-relative URL is not a path, and it would otherwise satisfy the
  // POSIX test below.
  if (url.startsWith("//")) return false;
  // POSIX absolute path with at least one further segment. A single segment is a
  // TMDB-relative reference ("/x.jpg"), not a local file.
  if (url.startsWith("/") && url.slice(1).includes("/")) return true;
  // Windows drive-absolute, either separator: C:\foo or C:/foo.
  if (/^[a-zA-Z]:[\\/]/.test(url)) return true;
  // Windows UNC share: \\server\share.
  return url.startsWith("\\\\");
}

/**
 * Strip a `file://` prefix down to a filesystem path.
 *
 * A well-formed Windows file URL is `file:///C:/x`, so removing the scheme
 * leaves a leading slash that Windows cannot open — `/C:/x` is not a path.
 */
export function localPathFromImageRef(url: string): string {
  if (!url.startsWith("file://")) return url;
  const withoutScheme = url.slice("file://".length);
  return /^\/[a-zA-Z]:/.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
}
