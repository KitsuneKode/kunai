import type { CoreProviderModule } from "@kunai/core";
import type {
  EndpointFailureClass,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";

import {
  isRetryableStatus,
  ProviderHttpError,
  providerFetch,
  statusToResolveErrorCode,
} from "../runtime/fetch";
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

const VIDLINK_API_ENDPOINT = "vidlink.pro";
const ENC_DEC_ENDPOINT = "enc-dec.app";

/**
 * Endpoint-health adapter for VidLink's two hard dependencies. Unlike Videasy
 * there is no pre-existing in-memory tracker to fall back on, so a missing
 * port simply means no quarantine — matching the pre-port behavior.
 */
function createVidlinkEndpointHealth(context: ProviderRuntimeContext) {
  const port = context.endpointHealth;
  return {
    shouldTry(endpoint: string): boolean {
      return port ? port.shouldTry(VIDLINK_PROVIDER_ID, endpoint) : true;
    },
    recordSuccess(endpoint: string): void {
      port?.recordSuccess(VIDLINK_PROVIDER_ID, endpoint);
    },
    recordFailure(endpoint: string, info: { class: EndpointFailureClass; titleId?: string }): void {
      port?.recordFailure(VIDLINK_PROVIDER_ID, endpoint, {
        class: info.class,
        titleId: info.titleId,
        at: context.now(),
      });
    },
  };
}

/**
 * Which failures are endpoint evidence. A `not-found` is the service saying it
 * does not carry this title — title-shaped, not health-shaped — so it must
 * never quarantine the host. Throttles and transport problems cool off;
 * sustained 5xx earns the longer server-error quarantine.
 */
function vidlinkFailureClass(code: ProviderHttpError["code"]): EndpointFailureClass | undefined {
  if (code === "provider-unavailable") return "server-error";
  if (
    code === "rate-limited" ||
    code === "blocked" ||
    code === "timeout" ||
    code === "network-error"
  ) {
    return "transient";
  }
  return undefined;
}

function vidlinkHttpError(status: number, endpoint: string, stage: string): ProviderHttpError {
  return new ProviderHttpError({
    providerId: VIDLINK_PROVIDER_ID,
    stage,
    status,
    message: `${endpoint} returned HTTP ${status}`,
    code: statusToResolveErrorCode(status),
    retryable: isRetryableStatus(status),
  });
}

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
      const encryptedId = await encryptTmdbId(ctx, tmdbId, ctx.signal, resolveInput.title.id);
      const path =
        resolveInput.mediaKind === "movie"
          ? `movie/${encryptedId}`
          : `tv/${encryptedId}/${season}/${episode}`;

      const response = await fetchVidlinkApi(
        ctx,
        `${VIDLINK_API_BASE}/${path}`,
        ctx.signal,
        resolveInput.title.id,
      );

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

/** Fetch VidLink API with retry on 5xx, inside the endpoint quarantine. */
async function fetchVidlinkApi(
  context: ProviderRuntimeContext,
  url: string,
  signal: AbortSignal | undefined,
  titleId: string | undefined,
): Promise<Response> {
  const endpointHealth = createVidlinkEndpointHealth(context);
  if (!endpointHealth.shouldTry(VIDLINK_API_ENDPOINT)) {
    throw new ProviderHttpError({
      providerId: VIDLINK_PROVIDER_ID,
      stage: "api",
      message: "vidlink.pro is quarantined after recent failures",
      code: "provider-unavailable",
      retryable: true,
    });
  }
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
      if (response.ok) {
        endpointHealth.recordSuccess(VIDLINK_API_ENDPOINT);
        return response;
      }
      const error = vidlinkHttpError(response.status, VIDLINK_API_ENDPOINT, "api");
      if (!signal?.aborted) {
        const failureClass = vidlinkFailureClass(error.code);
        if (failureClass)
          endpointHealth.recordFailure(VIDLINK_API_ENDPOINT, { class: failureClass, titleId });
      }
      if (attempt < maxAttempts && response.status >= 500 && !signal?.aborted) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    } catch (error) {
      if (!(error instanceof ProviderHttpError) && !signal?.aborted) {
        endpointHealth.recordFailure(VIDLINK_API_ENDPOINT, { class: "transient", titleId });
      }
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
  titleId: string | undefined,
): Promise<string> {
  const cached = encDecCache.get(tmdbId);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  const endpointHealth = createVidlinkEndpointHealth(context);
  if (!endpointHealth.shouldTry(ENC_DEC_ENDPOINT)) {
    throw new ProviderHttpError({
      providerId: VIDLINK_PROVIDER_ID,
      stage: "enc-dec",
      message: "enc-dec.app is quarantined after recent failures",
      code: "provider-unavailable",
      retryable: true,
    });
  }

  const maxAttempts = 2;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await providerFetch(context, `${ENC_DEC_BASE}/enc-vidlink?text=${tmdbId}`, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: directStreamFetchSignal(signal, VIDLINK_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw vidlinkHttpError(response.status, ENC_DEC_ENDPOINT, "enc-dec");
      }
      const data = (await response.json()) as { result?: string };
      if (!data?.result) {
        throw new Error("enc-dec.app did not return an encrypted id");
      }
      // TTL runs from when the value was received, not from when the request
      // started — a slow request must not shorten its own cache lifetime.
      rememberEncDecResult(tmdbId, data.result);
      endpointHealth.recordSuccess(ENC_DEC_ENDPOINT);
      return data.result;
    } catch (error) {
      if (!signal?.aborted) {
        const failureClass =
          error instanceof ProviderHttpError ? vidlinkFailureClass(error.code) : "transient";
        if (failureClass) {
          endpointHealth.recordFailure(ENC_DEC_ENDPOINT, { class: failureClass, titleId });
        }
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError ?? new Error("enc-dec.app encryption failed after retries");
}
