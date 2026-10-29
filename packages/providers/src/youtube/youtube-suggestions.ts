import { isJsonString } from "@kunai/types";

import { directStreamFetchSignal } from "../shared/direct-stream-source";
import { invidiousGetSearchSuggestions, type InvidiousClientOptions } from "./invidious-client";

const GOOGLE_SUGGEST_TIMEOUT_MS = 2_000;

/**
 * Fetch raw search suggestions for YouTube from Google's public suggestion endpoint.
 * Highly responsive (<50ms), unauthenticated, and matches official YouTube query auto-complete.
 */
export async function fetchGoogleYoutubeSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(trimmed)}`;
  try {
    const response = await fetch(url, {
      signal: directStreamFetchSignal(signal, GOOGLE_SUGGEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return [];
    // SAFETY: external Google suggestion JSON response shape is [query, suggestionsArray]
    const data = (await response.json()) as unknown;
    if (Array.isArray(data) && Array.isArray(data[1])) {
      return data[1]
        .filter(isJsonString)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

/**
 * Fetch YouTube search query suggestions with automatic Google -> Invidious fallback.
 */
export async function fetchYoutubeSearchSuggestions(
  query: string,
  options: InvidiousClientOptions = {},
): Promise<readonly string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Try Google's suggestion endpoint first (fast, reliable, unauthenticated)
  try {
    const suggestions = await fetchGoogleYoutubeSuggestions(trimmed, options.signal);
    if (suggestions.length > 0) return suggestions;
  } catch (error) {
    if (options.signal?.aborted) throw error;
  }

  // Fallback to Invidious search suggestions endpoint
  try {
    const fallback = await invidiousGetSearchSuggestions(trimmed, options);
    if (fallback.length > 0) return fallback;
  } catch (error) {
    if (options.signal?.aborted) throw error;
  }

  return [];
}
