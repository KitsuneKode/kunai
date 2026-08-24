import type { CoreProviderModule } from "@kunai/core";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import {
  directStreamFetchSignal,
  resolveDirectStreamSource,
  type DirectStreamInput,
  type DirectStreamPayload,
} from "../shared/direct-stream-source";
import { expandHlsMasterPlaylist, looksLikeHlsMasterUrl } from "../shared/hls-ladder";
import { vidlinkManifest, VIDLINK_PROVIDER_ID } from "./manifest";

export { VIDLINK_PROVIDER_ID };

const ENC_DEC_BASE = "https://enc-dec.app/api";
/** Playback environment VidLink maps to its DASH + signed-cookie delivery path. */
const VIDLINK_PLAYBACK_ENVIRONMENT = "webkit";
const VIDLINK_API_BASE = "https://vidlink.pro/api/b";
const VIDLINK_REFERER = "https://vidlink.pro/";
const VIDLINK_ORIGIN = "https://vidlink.pro";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const VIDLINK_FETCH_TIMEOUT_MS = 20_000;
const ENC_DEC_CACHE_TTL_MS = 30 * 60_000;
/**
 * Cap on memoized enc-dec results. Entries are tiny, but an unbounded
 * module-level Map grows for the whole process lifetime, and a long browsing
 * session touches many titles. Evicts oldest-first via Map insertion order.
 */
const ENC_DEC_CACHE_MAX_ENTRIES = 256;

const encDecCache = new Map<number, { result: string; expiresAt: number }>();

function rememberEncDecResult(tmdbId: number, result: string): void {
  // Refresh insertion order so re-encrypted ids are treated as recently used.
  encDecCache.delete(tmdbId);
  encDecCache.set(tmdbId, { result, expiresAt: Date.now() + ENC_DEC_CACHE_TTL_MS });
  while (encDecCache.size > ENC_DEC_CACHE_MAX_ENTRIES) {
    const oldest = encDecCache.keys().next();
    if (oldest.done) break;
    encDecCache.delete(oldest.value);
  }
}

interface VidlinkCaption {
  readonly url: string;
  readonly language?: string;
  readonly type?: string;
}

interface VidlinkStream {
  readonly type?: "hls" | "file" | "dash";
  readonly playlist?: string;
  readonly qualities?: Record<string, { url: string; type?: string } | undefined>;
  readonly captions?: readonly VidlinkCaption[];
  readonly headers?: Record<string, string>;
  /** CloudFront signed cookies for the manifest host; 403 without them. */
  readonly playlistHeaders?: Record<string, string>;
  readonly playbackMetadata?: {
    readonly format?: string;
    readonly codecName?: string;
    readonly resolutions?: readonly string[];
  };
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
    resolveGateProbe: true,
    fetchPayload: async ({ tmdbId, season, episode, input: resolveInput, context: ctx }) => {
      const encryptedId = await encryptTmdbId(ctx, tmdbId, ctx.signal);
      const path =
        resolveInput.mediaKind === "movie"
          ? `movie/${encryptedId}`
          : `tv/${encryptedId}/${season}/${episode}`;

      const response = await fetchVidlinkApi(ctx, `${VIDLINK_API_BASE}/${path}`, ctx.signal);

      const data = (await response.json()) as { stream?: VidlinkStream };
      const stream = data.stream;
      if (!stream) return null;

      const streams: DirectStreamInput[] = [];
      if (stream.type === "file" && stream.qualities) {
        for (const [quality, file] of Object.entries(stream.qualities)) {
          if (file?.url) streams.push({ url: file.url, qualityHint: quality });
        }
      }
      if (stream.playlist) {
        const playlistHeaders = {
          referer: VIDLINK_REFERER,
          origin: VIDLINK_ORIGIN,
          "user-agent": USER_AGENT,
          ...stream.playlistHeaders,
          ...stream.headers,
        };
        if (looksLikeHlsMasterUrl(stream.playlist) || /\.m3u8(?:[?#]|$)/i.test(stream.playlist)) {
          const variants = await expandHlsMasterPlaylist({
            fetch: (url: string, init?: RequestInit) =>
              providerFetch(ctx, url, {
                ...init,
                headers: {
                  ...playlistHeaders,
                  ...(init?.headers as Record<string, string> | undefined),
                },
                signal: directStreamFetchSignal(ctx.signal, VIDLINK_FETCH_TIMEOUT_MS),
              }),
            masterUrl: stream.playlist,
            headers: playlistHeaders,
            signal: ctx.signal,
          });
          for (const variant of variants) {
            streams.push({ url: variant.url, qualityHint: variant.qualityLabel });
          }
        } else {
          // A DASH manifest is one adaptive URL: mpv switches renditions inside
          // it, so the ladder is a label, not a list. `playbackMetadata` is the
          // only place the ceiling is stated, and without it the Tracks panel
          // shows a bare "auto" row for a stream that is really 1080p.
          streams.push({
            url: stream.playlist,
            qualityHint: highestVidlinkResolution(stream.playbackMetadata?.resolutions),
          });
        }
      }

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
          // The CloudFront cookie belongs on every request for this stream —
          // the manifest, its segments, and the resolve-gate probe. Dropping it
          // is a 403 from sacdn.hakunaymatata.com.
          ...stream.playlistHeaders,
          ...stream.headers,
        },
      };
      return payload;
    },
  });
}

/** Highest rendition VidLink states for a DASH manifest, as a `"1080p"`-style label. */
function highestVidlinkResolution(resolutions: readonly string[] | undefined): string | undefined {
  const heights = (resolutions ?? [])
    .map((entry) => Number.parseInt(entry, 10))
    .filter((height) => Number.isFinite(height) && height > 0);
  if (heights.length === 0) return undefined;
  return `${Math.max(...heights)}p`;
}

/** Fetch VidLink API with retry on 5xx. */
async function fetchVidlinkApi(
  context: ProviderRuntimeContext,
  url: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const maxAttempts = 2;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await providerFetch(context, url, {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          referer: VIDLINK_REFERER,
          origin: VIDLINK_ORIGIN,
          "user-agent": USER_AGENT,
          // Ask for the browser playback path. Without this VidLink answers with
          // `deliveryType: "file"` — direct MP4s on bcdn.hakunaymatata.com that
          // are flagged `requiresProxy` and answer 429 to every non-browser
          // client, so the lane resolved and then could not play. `webkit`
          // returns a DASH manifest on sacdn.hakunaymatata.com whose CloudFront
          // cookies arrive in `playlistHeaders`, and that plays directly.
          "x-playback-environment": VIDLINK_PLAYBACK_ENVIRONMENT,
        },
        signal: directStreamFetchSignal(signal, VIDLINK_FETCH_TIMEOUT_MS),
      });
      if (response.ok) return response;
      if (attempt < maxAttempts && response.status >= 500 && !signal?.aborted) {
        lastError = new Error(`VidLink API returned HTTP ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw new Error(`VidLink API returned HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= maxAttempts || signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error("VidLink API fetch failed");
}

/** Encrypt the TMDB id via enc-dec.app, which VidLink requires for its source path. */
async function encryptTmdbId(
  context: ProviderRuntimeContext,
  tmdbId: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const cached = encDecCache.get(tmdbId);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  const maxAttempts = 2;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await providerFetch(context, `${ENC_DEC_BASE}/enc-vidlink?text=${tmdbId}`, {
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
      // TTL runs from when the value was received, not from when the request
      // started — a slow request must not shorten its own cache lifetime.
      rememberEncDecResult(tmdbId, data.result);
      return data.result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError ?? new Error("enc-dec.app encryption failed after retries");
}
