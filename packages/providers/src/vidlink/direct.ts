import type { CoreProviderModule } from "@kunai/core";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";

import {
  directStreamFetchSignal,
  resolveDirectStreamSource,
  type DirectStreamInput,
  type DirectStreamPayload,
} from "../shared/direct-stream-source";
import { vidlinkManifest, VIDLINK_PROVIDER_ID } from "./manifest";

export { VIDLINK_PROVIDER_ID };

const ENC_DEC_BASE = "https://enc-dec.app/api";
const VIDLINK_API_BASE = "https://vidlink.pro/api/b";
const VIDLINK_REFERER = "https://vidlink.pro/";
const VIDLINK_ORIGIN = "https://vidlink.pro";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const VIDLINK_FETCH_TIMEOUT_MS = 20_000;

interface VidlinkCaption {
  readonly url: string;
  readonly language?: string;
  readonly type?: string;
}

interface VidlinkStream {
  readonly type?: "hls" | "file";
  readonly playlist?: string;
  readonly qualities?: Record<string, { url: string; type?: string } | undefined>;
  readonly captions?: readonly VidlinkCaption[];
  readonly headers?: Record<string, string>;
}

export const vidlinkProviderModule: CoreProviderModule = {
  providerId: VIDLINK_PROVIDER_ID,
  manifest: vidlinkManifest,
  resolve: resolveVidlinkDirect,
};

export function resolveVidlinkDirect(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<ProviderResolveResult> {
  return resolveDirectStreamSource({
    providerId: VIDLINK_PROVIDER_ID,
    host: "vidlink.pro",
    label: "VidLink",
    input,
    context,
    fetchPayload: async ({ tmdbId, season, episode, input: resolveInput, context: ctx }) => {
      const encryptedId = await encryptTmdbId(tmdbId, ctx.signal);
      const path =
        resolveInput.mediaKind === "movie"
          ? `movie/${encryptedId}`
          : `tv/${encryptedId}/${season}/${episode}`;

      const response = await fetch(`${VIDLINK_API_BASE}/${path}`, {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          referer: VIDLINK_REFERER,
          origin: VIDLINK_ORIGIN,
          "user-agent": USER_AGENT,
        },
        signal: directStreamFetchSignal(ctx.signal, VIDLINK_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`VidLink API returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as { stream?: VidlinkStream };
      const stream = data.stream;
      if (!stream) return null;

      const streams: DirectStreamInput[] = [];
      if (stream.type === "file" && stream.qualities) {
        for (const [quality, file] of Object.entries(stream.qualities)) {
          if (file?.url) streams.push({ url: file.url, qualityHint: quality });
        }
      }
      if (stream.playlist) streams.push({ url: stream.playlist });

      const payload: DirectStreamPayload = {
        streams,
        subtitles: (stream.captions ?? []).map((caption) => ({
          url: caption.url,
          language: caption.language,
          type: caption.type,
        })),
        headers: {
          referer: VIDLINK_REFERER,
          origin: VIDLINK_ORIGIN,
          "user-agent": USER_AGENT,
          ...stream.headers,
        },
      };
      return payload;
    },
  });
}

/** Encrypt the TMDB id via enc-dec.app, which VidLink requires for its source path. */
async function encryptTmdbId(tmdbId: number, signal: AbortSignal | undefined): Promise<string> {
  const response = await fetch(`${ENC_DEC_BASE}/enc-vidlink?text=${tmdbId}`, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: directStreamFetchSignal(signal, VIDLINK_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`enc-dec.app returned HTTP ${response.status}`);
  }
  const data = (await response.json()) as { result?: string };
  if (!data?.result) {
    throw new Error("enc-dec.app did not return an encrypted id");
  }
  return data.result;
}
