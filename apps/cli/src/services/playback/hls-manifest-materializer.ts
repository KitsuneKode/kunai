import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamInfo } from "@/domain/types";
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

export async function materializeHlsManifestForPlayback(
  stream: StreamInfo,
): Promise<MaterializedHlsManifest | null> {
  const manifestUrl = stream.url;
  if (!manifestUrl?.startsWith("http") || !isHlsPlaylistUrl(manifestUrl)) {
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
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`HLS manifest fetch failed with HTTP ${response.status}`);
  }

  const manifestText = await response.text();
  if (!shouldMaterializeHlsManifest(manifestUrl, manifestText)) {
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
