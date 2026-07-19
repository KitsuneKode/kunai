import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamInfo } from "@/domain/types";
import { streamNeedsHlsRelay } from "@/infra/player/hls-relay";
import {
  absolutizeHostRootHlsManifest,
  isHlsPlaylistUrl,
  shouldMaterializeHlsManifest,
} from "@kunai/providers";

export type MaterializedHlsManifest = {
  readonly stream: StreamInfo;
  readonly cleanup: () => Promise<void>;
};

const HLS_FETCH_TIMEOUT_MS = 30_000;

export {
  absolutizeHostRootHlsManifest,
  isHlsPlaylistUrl,
  manifestUsesHostRootSegmentPaths,
  shouldMaterializeHlsManifest,
} from "@kunai/providers";

/** @deprecated Use isKnownHostRootHlsCdn from @kunai/providers */
export function shouldMaterializeHlsManifestForHost(url: string): boolean {
  return isHlsPlaylistUrl(url);
}

/**
 * Why materialization was skipped. Materializing is an optimization (rewrite
 * host-root segment paths so ffmpeg/mpv parses large playlists), never a
 * requirement, so every failure falls through to the direct URL. Reporting the
 * reason keeps a fingerprint-blocked CDN visible instead of silently degrading.
 */
export type HlsMaterializeSkipReason =
  | "not-hls"
  | "relay-owned"
  | "fetch-failed"
  | "http-error"
  | "not-needed";

export async function materializeHlsManifestForPlayback(
  stream: StreamInfo,
  onSkipped?: (reason: HlsMaterializeSkipReason, detail?: string) => void,
): Promise<MaterializedHlsManifest | null> {
  const manifestUrl = stream.url;
  if (!manifestUrl?.startsWith("http") || !isHlsPlaylistUrl(manifestUrl)) {
    onSkipped?.("not-hls");
    return null;
  }
  // Fingerprint-blocked CDNs must stay remote so the HLS relay can proxy segments.
  if (streamNeedsHlsRelay(manifestUrl)) {
    onSkipped?.("relay-owned");
    return null;
  }

  const headers = stream.headers ?? {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HLS_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(manifestUrl, {
      headers: {
        accept: "*/*",
        ...headers,
      },
      signal: controller.signal,
    });
  } catch (error: unknown) {
    clearTimeout(timeout);
    // Connection reset / TLS rejection / timeout: the CDN likely blocks Bun's
    // fetch fingerprint the same way those CDNs block mpv. mpv may still
    // negotiate it directly, so fall through rather than failing playback.
    onSkipped?.("fetch-failed", error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    onSkipped?.("http-error", `HTTP ${response.status}`);
    return null;
  }

  const manifestText = await response.text();
  if (!shouldMaterializeHlsManifest(manifestUrl, manifestText)) {
    onSkipped?.("not-needed");
    return null;
  }

  const dir = await createTempDir();
  const playlistPath = join(dir, "playlist.m3u8");
  const absolutized = absolutizeHostRootHlsManifest(manifestText, manifestUrl);
  await writeFile(playlistPath, absolutized, "utf8");

  return {
    stream: {
      ...stream,
      url: playlistPath,
    },
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `kunai-hls-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
