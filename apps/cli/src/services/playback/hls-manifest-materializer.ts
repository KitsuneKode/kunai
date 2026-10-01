import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StreamInfo } from "@/domain/types";
import { createPrivateTempDir } from "@/infra/fs/temp-dir";
import { streamNeedsHlsRelay } from "@/infra/player/hls-relay";
import {
  absolutizeHostRootHlsManifest,
  fetchGuardedStreamTarget,
  isHlsPlaylistUrl,
  shouldMaterializeHlsManifest,
} from "@kunai/providers";

export type MaterializedHlsManifest = {
  readonly stream: StreamInfo;
  readonly cleanup: () => Promise<void>;
};

const HLS_FETCH_TIMEOUT_MS = 30_000;
/** Manifests are kilobytes; a body past this is a hostile or broken endpoint. */
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

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
 * host-root segment paths so ffmpeg/mpv parses large playlists). Transport
 * failures fall through because mpv may negotiate them differently, while a
 * terminal HTTP response is surfaced to the player boundary so it can reject a
 * known-dead URL before opening a black player window.
 */
export type HlsMaterializeSkipReason =
  | "not-hls"
  | "relay-owned"
  | "fetch-failed"
  | "http-error"
  | "blocked-target"
  | "not-needed";

export function isTerminalHlsHttpStatus(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

export async function materializeHlsManifestForPlayback(
  stream: StreamInfo,
  onSkipped?: (reason: HlsMaterializeSkipReason, detail?: string, httpStatus?: number) => void,
  callerSignal?: AbortSignal,
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
  // A user abort must cancel the fetch, not wait out the deadline.
  const fetchSignal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  let manifestText: string;
  try {
    const outcome = await fetchGuardedStreamTarget({
      fetchImpl: fetch,
      url: manifestUrl,
      init: {
        headers: {
          accept: "*/*",
          ...headers,
        },
      },
      signal: fetchSignal,
      timeoutMs: HLS_FETCH_TIMEOUT_MS,
    });
    if (outcome.kind === "blocked") {
      // A private or non-http target is terminal, not a skip — letting mpv
      // take the direct URL would fetch the very address the guard rejected.
      onSkipped?.("blocked-target", outcome.reason);
      return null;
    }
    if (outcome.kind === "timeout") {
      onSkipped?.("fetch-failed", "manifest fetch aborted");
      return null;
    }
    const response = outcome.response;
    if (!response.ok) {
      onSkipped?.("http-error", `HTTP ${response.status}`, response.status);
      return null;
    }
    // The deadline stays armed through the body read — headers arriving fast
    // must not disarm it against a body that drips forever.
    const body = await readBodyCapped(response);
    if (body === null) {
      onSkipped?.("fetch-failed", `manifest body exceeds ${MAX_MANIFEST_BYTES} bytes`);
      return null;
    }
    manifestText = body;
  } catch (error: unknown) {
    // Connection reset / TLS rejection / timeout mid-body: the CDN likely
    // blocks Bun's fetch fingerprint the same way those CDNs block mpv. mpv
    // may still negotiate it directly, so fall through rather than failing
    // playback.
    onSkipped?.("fetch-failed", error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!shouldMaterializeHlsManifest(manifestUrl, manifestText)) {
    onSkipped?.("not-needed");
    return null;
  }

  const dir = await createPrivateTempDir("hls");
  const playlistPath = join(dir, "playlist.m3u8");
  const absolutized = absolutizeHostRootHlsManifest(manifestText, manifestUrl);
  // Signed CDN URLs land in this file — keep it owner-only like the mpv IPC
  // socket dir, not world-readable in a shared tmp.
  await writeFile(playlistPath, absolutized, { encoding: "utf8", mode: 0o600 });

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
async function readBodyCapped(response: Response): Promise<string | null> {
  const body = response.body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
