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
const sourceInflight = new Map<string, Promise<PosterSource | null>>();

function getTmdbSize(cols: number, variant: "preview" | "detail"): string {
  if (variant === "detail") return cols <= 28 ? "w500" : "w780";
  if (cols <= 18) return "w342";
  if (cols <= 28) return "w500";
  // Never "original": a terminal pane tops out near 40 cells (~400px), so
  // multi-megabyte originals only add fetch latency, decode time, and RAM in
  // the source cache without changing a single output cell.
  return "w780";
}

export function resolvePosterUrl(
  url: string,
  { cols = 18, variant = "preview" }: { cols?: number; variant?: "preview" | "detail" } = {},
): string {
  if (isLocalImagePath(url)) return url.startsWith("file://") ? url.slice("file://".length) : url;
  const resolved = resolveCatalogPosterUrl(url, { tmdbSize: getTmdbSize(cols, variant) });
  return resolved ?? url;
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

async function readRemotePosterSource(
  url: string,
  signal?: AbortSignal,
): Promise<PosterSource | null> {
  const timeout = AbortSignal.timeout(5000);
  const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await observeOnlineIfBound("poster-error", () =>
    fetch(url, { signal: fetchSignal }),
  );
  if (!response.ok || !response.body) {
    // Drain nothing; just let the body go.
    await response.body?.cancel("unused").catch(() => {});
    return null;
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_POSTER_SOURCE_BYTES) {
    await response.body.cancel("too-large").catch(() => {});
    return null;
  }

  const bytes = await readPosterStream(response.body, signal);
  if (!bytes || bytes.byteLength === 0) return null;
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
  const cached = sourceCache.get(resolved);
  if (cached) return cached;

  // Don't join an aborted-capable leader — same rule as fetchPoster.
  const inflight = sourceInflight.get(resolved);
  if (inflight && !signal) return inflight;

  const task = (async (): Promise<PosterSource | null> => {
    try {
      if (signal?.aborted) return null;
      const source = isLocalImagePath(resolved)
        ? await readLocalPosterSource(resolved, signal)
        : await readRemotePosterSource(resolved, signal);
      if (!source || signal?.aborted) return null;
      // Only a complete, in-bounds, unaborted read is worth remembering; caching
      // a failure would make one dropped connection permanent for the process.
      sourceCache.set(resolved, source);
      return source;
    } catch {
      return null;
    }
  })();

  sourceInflight.set(resolved, task);
  try {
    return await task;
  } finally {
    // Preserve a newer abort-capable leader registered for the same URL. An
    // unconditional delete here made the source layer look idle while that
    // newer fetch was still running.
    if (sourceInflight.get(resolved) === task) sourceInflight.delete(resolved);
  }
}

function isLocalImagePath(url: string): boolean {
  if (url.startsWith("file://")) return true;
  return url.startsWith("/") && url.slice(1).includes("/");
}
