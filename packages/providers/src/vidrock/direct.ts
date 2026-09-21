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
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { vidrockManifest, VIDROCK_PROVIDER_ID } from "./manifest";

export { VIDROCK_PROVIDER_ID };

const BASE_URL = "https://vidrock.net/api";
const ORIGIN = "https://vidrock.net";
const REFERER = "https://vidrock.net/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const VIDROCK_FETCH_TIMEOUT_MS = 20_000;

/**
 * AES-256-GCM key recovered from the site's player bundle (vidrock.net). The
 * API answers `GET /api/movie/{tmdbId}` / `GET /api/tv/{tmdbId}/{s}/{e}` with a
 * map of server lanes whose `url` fields are base64url(iv ‖ ciphertext).
 */
const VIDROCK_KEY_HEX = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
const VIDROCK_GCM_IV_LENGTH = 12;

/**
 * The stream hosts (cdn.ngcorp.*, the workers.dev lanes) drop any request that
 * carries a real User-Agent and accept requests whose UA header is a single
 * space — which is also what `mpv --user-agent=" "` sends to every playlist and
 * segment request. A real browser UA fails; an absent UA is not expressible in
 * ffmpeg, so the space is the working value.
 */
const STREAM_USER_AGENT = " ";

interface VidrockServerEntry {
  readonly url?: string | null;
  readonly type?: string | null;
  readonly language?: string | null;
  readonly flag?: string | null;
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
      const response = await fetch(`${BASE_URL}/${path}`, {
        headers: { Origin: ORIGIN, Referer: REFERER, "User-Agent": USER_AGENT },
        signal: directStreamFetchSignal(ctx.signal, VIDROCK_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`VidRock API returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;

      const key = await vidrockGcmKey();
      const streams: DirectStreamInput[] = [];
      for (const [name, server] of Object.entries(
        data as Record<string, VidrockServerEntry | undefined>,
      )) {
        const ciphertext = server?.url;
        if (!ciphertext) continue;

        let url: string;
        try {
          url = await decryptVidrockStreamUrl(ciphertext, key);
        } catch {
          // A lane whose ciphertext no longer verifies is skipped rather than
          // failing the whole resolve — the scheme rotates per deploy and the
          // remaining lanes still play.
          continue;
        }

        const audio = normalizeIsoLanguageCode(server?.language ?? undefined);
        const audioLanguages = audio ? [audio] : undefined;

        if (url.includes("/playlist/")) {
          const playlist = await fetchPlaylist(url, ctx.signal, {
            Referer: REFERER,
            "User-Agent": USER_AGENT,
          });
          for (const item of playlist) {
            streams.push({
              url: item.url,
              qualityHint: item.resolution,
              serverLabel: name,
              audioLanguages,
            });
          }
          continue;
        }

        streams.push({ url, serverLabel: name, audioLanguages });
      }
      if (streams.length === 0) return null;

      const payload: DirectStreamPayload = {
        streams,
        // No Referer: the ngcorp segment hosts stall connections that carry
        // vidrock.net as referer; the playlist host itself needs no headers.
        headers: { "user-agent": STREAM_USER_AGENT },
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
    bytes[i] = parseInt(VIDROCK_KEY_HEX.substr(i * 2, 2), 16);
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
  signal: AbortSignal | undefined,
  headers: Record<string, string>,
): Promise<{ url: string; resolution: string }[]> {
  const response = await fetch(url, {
    headers,
    signal: directStreamFetchSignal(signal, VIDROCK_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is { url: string; resolution: unknown } =>
      Boolean(item && typeof item === "object" && "url" in item && item.url),
    )
    .map((item) => ({ url: String(item.url), resolution: String(item.resolution ?? "") }));
}
