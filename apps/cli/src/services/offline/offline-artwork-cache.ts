import { stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { writeAtomicBytes } from "@/infra/fs/atomic-write";
import type { DownloadJobRecord } from "@kunai/storage";

export type OfflineArtworkFetch = (url: string, init: RequestInit) => Promise<Response>;

const POSTER_CACHE_TIMEOUT_MS = 10_000;

export function resolveOfflinePosterArtifactPath(job: DownloadJobRecord): string {
  const ext = posterExtension(job.posterUrl);
  return join(dirname(job.outputPath), `${artifactBaseName(job.outputPath)}.poster${ext}`);
}

export async function cacheOfflinePosterArtwork(input: {
  readonly job: DownloadJobRecord;
  readonly fetchImpl?: OfflineArtworkFetch;
}): Promise<string | null> {
  const posterUrl = input.job.posterUrl;
  if (!posterUrl) return null;

  const targetPath = resolveOfflinePosterArtifactPath(input.job);
  const existing = await stat(targetPath).catch(() => null);
  if (existing?.isFile() && existing.size > 0) return targetPath;

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(posterUrl, {
    signal: AbortSignal.timeout(POSTER_CACHE_TIMEOUT_MS),
    headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
  });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) return null;

  const data = await response.arrayBuffer();
  if (data.byteLength <= 0) return null;
  await writeAtomicBytes(targetPath, data);
  return targetPath;
}

function artifactBaseName(outputPath: string): string {
  const base = basename(outputPath);
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base || "poster";
}

function posterExtension(url: string | undefined): ".jpg" | ".png" | ".webp" {
  if (!url) return ".jpg";
  try {
    const ext = extname(new URL(url).pathname).toLowerCase();
    if (ext === ".png" || ext === ".webp") return ext;
  } catch {
    // keep default jpg
  }
  return ".jpg";
}
