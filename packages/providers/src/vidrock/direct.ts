import type { CoreProviderModule } from "@kunai/core";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";
import CryptoJS from "crypto-js";

import {
  directStreamFetchSignal,
  resolveDirectStreamSource,
  type DirectStreamInput,
  type DirectStreamPayload,
} from "../shared/direct-stream-source";
import { vidrockManifest, VIDROCK_PROVIDER_ID } from "./manifest";

export { VIDROCK_PROVIDER_ID };

const BASE_URL = "https://vidrock.net/api";
const ORIGIN = "https://vidrock.net";
const REFERER = "https://vidrock.net/";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
const PASSPHRASE = "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9";
const VIDROCK_FETCH_TIMEOUT_MS = 20_000;

interface VidrockServer {
  readonly url?: string;
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
    fetchPayload: async ({ tmdbId, season, episode, input: resolveInput, context: ctx }) => {
      const apiType = resolveInput.mediaKind === "movie" ? "movie" : "show";
      const itemId =
        resolveInput.mediaKind === "movie" ? String(tmdbId) : `${tmdbId}_${season}_${episode}`;
      const encoded = encodeURIComponent(encryptItemId(itemId));
      const headers = { Origin: ORIGIN, Referer: REFERER, "User-Agent": USER_AGENT };

      const response = await fetch(`${BASE_URL}/${apiType}/${encoded}`, {
        headers,
        signal: directStreamFetchSignal(ctx.signal, VIDROCK_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`VidRock API returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as Record<string, VidrockServer | undefined> | unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;

      const streams: DirectStreamInput[] = [];
      for (const [name, server] of Object.entries(
        data as Record<string, VidrockServer | undefined>,
      )) {
        const url = server?.url;
        if (!url) continue;
        // Skip Astra / Cloudflare-worker mirrors that are unreliable from a CLI.
        if (name.includes("Astra") || url.includes(".workers.dev")) continue;

        if (name === "Atlas" || url.includes("cdn.vidrock.store/playlist/")) {
          const playlist = await fetchPlaylist(url, ctx.signal, headers);
          for (const item of playlist)
            streams.push({ url: item.url, qualityHint: item.resolution });
          continue;
        }
        streams.push({ url });
      }

      const payload: DirectStreamPayload = {
        streams,
        headers: { origin: ORIGIN, referer: REFERER, "user-agent": USER_AGENT },
      };
      return payload;
    },
  });
}

/** AES-CBC encrypt the item id, then base64url-encode (VidRock's addressing scheme). */
function encryptItemId(itemId: string): string {
  const key = CryptoJS.enc.Utf8.parse(PASSPHRASE);
  const iv = CryptoJS.enc.Utf8.parse(PASSPHRASE.substring(0, 16));
  const encrypted = CryptoJS.AES.encrypt(itemId, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.ciphertext
    .toString(CryptoJS.enc.Base64)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
