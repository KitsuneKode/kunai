import { isJsonString, type JsonValue } from "@kunai/types";

import { directStreamFetchSignal } from "../shared/direct-stream-source";
import { invidiousGetSearchSuggestions, type InvidiousClientOptions } from "./invidious-client";

const GOOGLE_SUGGEST_TIMEOUT_MS = 2_000;

function suggestionStrings(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value
        .filter(isJsonString)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

/**
 * Fetch raw search suggestions for YouTube from Google's public suggestion endpoint.
 * Uses a bounded request; callers may instead select their own Invidious instance.
 */
export async function fetchGoogleYoutubeSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  signal?.throwIfAborted();

  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(trimmed)}`;
  try {
    const response = await fetch(url, {
      signal: directStreamFetchSignal(signal, GOOGLE_SUGGEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return [];
    // SAFETY: Response.json parses JSON; array and string shapes are checked before use.
    const data = (await response.json()) as JsonValue;
    return suggestionStrings(Array.isArray(data) ? data[1] : undefined);
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
  options.signal?.throwIfAborted();

  // An explicit instance is a routing choice, not permission to send drafts elsewhere.
  if (options.preferredInstanceUrl?.trim()) {
    return suggestionStrings(
      await invidiousGetSearchSuggestions(trimmed, { ...options, allowInstanceFallback: false }),
    );
  }

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
