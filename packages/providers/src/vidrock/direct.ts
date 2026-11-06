import type { CoreProviderModule } from "@kunai/core";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";

import { ProviderHttpError, providerFetch } from "../runtime/fetch";
import {
  directStreamFetchSignal,
  resolveDirectStreamSource,
  type DirectStreamInput,
  type DirectStreamPayload,
  type DirectSubtitleInput,
} from "../shared/direct-stream-source";
import { expandHlsMasterInventory, isHlsDeadHostStatus } from "../shared/hls-ladder";
import { blockedLiteralTargetReason } from "../shared/stream-reachability";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { vidrockManifest, VIDROCK_PROVIDER_ID } from "./manifest";

export { VIDROCK_PROVIDER_ID };

const BASE_URL = "https://vidrock.net/api";
const ORIGIN = "https://vidrock.net";
const REFERER = "https://vidrock.net/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const VIDROCK_FETCH_TIMEOUT_MS = 20_000;

/**
 * AES-256-GCM key recovered from the site's player bundle (vidrock.net). The
 * API answers `GET /api/movie/{tmdbId}` / `GET /api/tv/{tmdbId}/{s}/{e}` with a
 * map of server lanes whose `url` fields are base64url(iv ‖ ciphertext).
 *
 * Exported for the rotation canary in `test/vidrock-crypto.test.ts`: when
 * upstream redeploys with a new key, the pinned shape + live-vector decrypt
 * fail fast in CI instead of surfacing as empty resolves. Recovery: re-extract
 * the hex constant from the site's `index-*.js` (search `AES-GCM`/`importKey`);
 * see `.docs/provider-dossiers/vidrock.md` (key rotation).
 */
export const VIDROCK_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
const VIDROCK_GCM_IV_LENGTH = 12;

/**
 * Stream-host headers (verified live 2026-10-13 on Nova/Atlas/Luna/Orion for
 * TMDB 550). The CDN/commit hosts (boomchick, workers.dev, digitalmonarch)
 * now REQUIRE a browser UA plus the vidrock.net Referer: the old single-space
 * UA gets 403 on Atlas, 404 on Luna, a Cloudflare challenge page on Orion,
 * and wrong-content bytes on Nova — while browser headers return valid
 * `application/vnd.apple.mpegurl` on all four. The contract flipped upstream;
 * if resolves go hollow again, re-probe both header sets before assuming key
 * rotation (the GCM key is the other half of this provider's drift surface).
 */
const STREAM_USER_AGENT = USER_AGENT;
const STREAM_REFERER = REFERER;
const STREAM_ORIGIN = ORIGIN;

interface VidrockServerEntry {
  readonly url?: string | null;
  readonly language?: string | null;
}

export const vidrockProviderModule: CoreProviderModule = {
  providerId: VIDROCK_PROVIDER_ID,
  manifest: vidrockManifest,
  resolve: resolveVidrockDirect,
};

export function resolveVidrockDirect(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<ProviderResolveResult> {
  return resolveDirectStreamSource({
    providerId: VIDROCK_PROVIDER_ID,
    host: "vidrock.net",
    label: "VidRock",
    input,
    context,
    resolveGateProbe: true,
    fetchPayload: async ({ tmdbId, season, episode, input: resolveInput, context: ctx }) => {
      const path =
        resolveInput.mediaKind === "movie"
          ? `movie/${tmdbId}`
          : `tv/${tmdbId}/${season}/${episode}`;
      const response = await providerFetch(ctx, `${BASE_URL}/${path}`, {
        headers: { Origin: ORIGIN, Referer: REFERER, "User-Agent": USER_AGENT },
        signal: directStreamFetchSignal(ctx.signal, VIDROCK_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new ProviderHttpError({
          message: `VidRock API returned HTTP ${response.status}`,
          providerId: VIDROCK_PROVIDER_ID,
          stage: "api",
          status: response.status,
          // A 404/410 means the title is not on this upstream — a definitive
          // catalog answer, not a retryable outage.
          code: response.status === 404 || response.status === 410 ? "not-found" : "network-error",
          retryable: response.status >= 500 || response.status === 429,
        });
      }

      const data = (await response.json()) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;

      const key = await vidrockGcmKey();
      const streams: DirectStreamInput[] = [];
      const subtitles: DirectSubtitleInput[] = [];
      let ciphertextLanes = 0;
      let decryptFailures = 0;
      const entries = Object.entries(data as Record<string, VidrockServerEntry | undefined>);
      const laneResults = await Promise.all(
        entries.map(async ([name, server]) => {
          const ciphertext = server?.url;
          if (!ciphertext) return null;
          let url: string;
          try {
            url = await decryptVidrockStreamUrl(ciphertext, key);
          } catch {
            return { decryptFailure: true };
          }
          const audio = normalizeIsoLanguageCode(server?.language ?? undefined);
          const audioLanguages = audio ? [audio] : undefined;
          const laneStreams: DirectStreamInput[] = [];
          const laneSubtitles: DirectSubtitleInput[] = [];

          if (url.includes("/playlist/")) {
            try {
              const playlist = await fetchPlaylist(url, ctx, {
                "User-Agent": STREAM_USER_AGENT,
                Referer: STREAM_REFERER,
                Origin: STREAM_ORIGIN,
              });
              for (const item of playlist) {
                laneStreams.push({
                  url: item.url,
                  qualityHint: item.resolution,
                  serverLabel: name,
                  audioLanguages,
                });
              }
            } catch (error) {
              if (ctx.signal?.aborted) throw error;
              return { laneStreams, laneSubtitles };
            }
            return { laneStreams, laneSubtitles };
          }

          const inventory = await expandHlsMasterInventory({
            fetch: ctx.fetch?.fetch.bind(ctx.fetch) ?? fetch,
            resolvesLocally: ctx.fetch?.resolvesLocally,
            masterUrl: url,
            headers: {
              "user-agent": STREAM_USER_AGENT,
              referer: STREAM_REFERER,
              origin: STREAM_ORIGIN,
            },
            signal: directStreamFetchSignal(ctx.signal, 8_000),
          });
          if (isHlsDeadHostStatus(inventory.probe.httpStatus))
            return { laneStreams, laneSubtitles };
          if (inventory.isHls) {
            for (const track of inventory.subtitleTracks) {
              laneSubtitles.push({ url: track.url, language: track.language, label: track.label });
            }
            for (const variant of inventory.variants) {
              laneStreams.push({
                url: variant.url,
                protocol: "hls",
                qualityHint: variant.qualityLabel,
                serverLabel: name,
                audioLanguages: inventory.audioLanguages.length
                  ? inventory.audioLanguages
                  : audioLanguages,
              });
            }
          } else {
            laneStreams.push({ url, serverLabel: name, audioLanguages });
          }
          return { laneStreams, laneSubtitles };
        }),
      );

      for (const res of laneResults) {
        if (!res) continue;
        if ("decryptFailure" in res) {
          ciphertextLanes += 1;
          decryptFailures += 1;
          continue;
        }
        ciphertextLanes += 1;
        streams.push(...res.laneStreams);
        subtitles.push(...res.laneSubtitles);
      }
      if (streams.length === 0) {
        // Every lane carried ciphertext and every decrypt failed: the blob
        // shape parsed, so this is almost certainly a rotated scheme or key —
        // a diagnosable provider outage, not an honest "title not listed".
        if (ciphertextLanes > 0 && decryptFailures === ciphertextLanes) {
          throw new ProviderHttpError({
            message: `all ${ciphertextLanes} VidRock lanes failed GCM decrypt — upstream scheme likely rotated`,
            providerId: VIDROCK_PROVIDER_ID,
            stage: "decrypt",
            code: "parse-failed",
            retryable: false,
          });
        }
        return null;
      }

      const payload: DirectStreamPayload = {
        streams,
        subtitles,
        // current-Chrome UA + vidrock.net Referer and Origin on every playlist
        // and segment request: the CDN hosts challenge (403/404/CF page) or
        // serve wrong content without them (verified 2026-10-13). These headers
        // also ride the mpv handoff, so the probed request and the shipped
        // request stay identical per the resolve-gate contract.
        headers: {
          "user-agent": STREAM_USER_AGENT,
          referer: STREAM_REFERER,
          origin: STREAM_ORIGIN,
        },
      };
      return payload;
    },
  });
}

let cachedKey: CryptoKey | undefined;

async function vidrockGcmKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const bytes = new Uint8Array(VIDROCK_KEY_HEX.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(VIDROCK_KEY_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  cachedKey = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["decrypt"]);
  return cachedKey;
}

/** Decrypt a base64url(iv ‖ AES-256-GCM ciphertext) server `url` field. */
export async function decryptVidrockStreamUrl(
  ciphertext: string,
  key?: CryptoKey,
): Promise<string> {
  const b64 = ciphertext.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 2 ? "==" : b64.length % 4 === 3 ? "=" : "";
  const bytes = Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
  if (bytes.length < VIDROCK_GCM_IV_LENGTH + 16) {
    throw new Error("VidRock ciphertext too short");
  }
  const cryptoKey = key ?? (await vidrockGcmKey());
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, VIDROCK_GCM_IV_LENGTH) },
    cryptoKey,
    bytes.slice(VIDROCK_GCM_IV_LENGTH),
  );
  return new TextDecoder().decode(plain);
}

async function fetchPlaylist(
  url: string,
  ctx: ProviderRuntimeContext,
  headers: Record<string, string>,
): Promise<{ url: string; resolution: string }[]> {
  // The URL comes out of upstream ciphertext — provider-supplied, not vetted.
  // Route through the fetch port like every other call (test transports,
  // relay) and refuse literal private targets before any bytes move.
  if (blockedLiteralTargetReason(url) !== null) return [];
  const response = await providerFetch(ctx, url, {
    headers,
    signal: directStreamFetchSignal(ctx.signal, VIDROCK_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const data: unknown = await response.json();
  if (!Array.isArray(data)) return [];
  const out: { url: string; resolution: string }[] = [];
  for (const item of data) {
    if (!(item instanceof Object) || !("url" in item) || !item.url) continue;
    const resolution = "resolution" in item ? item.resolution : undefined;
    out.push({ url: String(item.url), resolution: String(resolution ?? "") });
  }
  return out;
}
