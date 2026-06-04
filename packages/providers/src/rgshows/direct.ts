import type { CoreProviderModule } from "@kunai/core";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";

import {
  directStreamFetchSignal,
  resolveDirectStreamSource,
  type DirectStreamPayload,
} from "../shared/direct-stream-source";
import { rgshowsManifest, RGSHOWS_PROVIDER_ID } from "./manifest";

export { RGSHOWS_PROVIDER_ID };

const BASE_URL = "https://api.rgshows.ru/main";
const REQUEST_REFERER = "https://rgshows.ru/";
const REQUEST_ORIGIN = "https://rgshows.ru";
const STREAM_REFERER = "https://www.rgshows.ru/";
const STREAM_ORIGIN = "https://www.rgshows.ru";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const RGSHOWS_FETCH_TIMEOUT_MS = 20_000;

interface RgshowsResponse {
  readonly stream?: { readonly url?: string };
}

export const rgshowsProviderModule: CoreProviderModule = {
  providerId: RGSHOWS_PROVIDER_ID,
  manifest: rgshowsManifest,
  resolve: resolveRgshowsDirect,
};

export function resolveRgshowsDirect(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<ProviderResolveResult> {
  return resolveDirectStreamSource({
    providerId: RGSHOWS_PROVIDER_ID,
    host: "rgshows.ru",
    label: "RGShows",
    input,
    context,
    fetchPayload: async ({ tmdbId, season, episode, input: resolveInput, context: ctx }) => {
      const path =
        resolveInput.mediaKind === "movie"
          ? `movie/${tmdbId}`
          : `tv/${tmdbId}/${season}/${episode}`;

      const response = await fetch(`${BASE_URL}/${path}`, {
        headers: {
          accept: "*/*",
          referer: REQUEST_REFERER,
          origin: REQUEST_ORIGIN,
          "user-agent": USER_AGENT,
        },
        signal: directStreamFetchSignal(ctx.signal, RGSHOWS_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`RGShows API returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as RgshowsResponse;
      const url = data.stream?.url;
      if (!url) return null;

      const payload: DirectStreamPayload = {
        streams: [{ url }],
        headers: {
          referer: STREAM_REFERER,
          origin: STREAM_ORIGIN,
          "user-agent": USER_AGENT,
        },
      };
      return payload;
    },
  });
}
