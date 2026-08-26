import type { SearchResult, TitleInfo } from "@/domain/types";

import type { Provider } from "./Provider";

/**
 * Warm the persistent episode cache for the top anime result of a search, in
 * the background, so the ~6s Cloudflare-gated catalog fetch is already paid by
 * the time the user picks it.
 *
 * Deliberately conservative:
 * - Only the single top anime result is warmed — one gated call per search, not
 *   a barrage that would provoke the WAF for titles the user scrolls past.
 * - `warmed` dedupes across searches so the same title is not re-fetched.
 * - Fire-and-forget: a warm must never block, delay, or fail the search, so
 *   every failure is swallowed.
 *
 * It calls the provider's `listEpisodes`, which resolves through the
 * cache-carrying runtime context and populates `provider_cache` as a side
 * effect. Nothing here reads the result.
 */
export function warmTopAnimeEpisodeCache(input: {
  readonly results: readonly SearchResult[];
  readonly provider: Provider | undefined;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly warmed: Set<string>;
  readonly signal?: AbortSignal;
}): void {
  const { results, provider, warmed } = input;
  if (!provider?.listEpisodes) return;

  const top = results.find((result) => result.isAnime && result.id.trim().length > 0);
  if (!top || warmed.has(top.id)) return;
  warmed.add(top.id);

  const title: TitleInfo = {
    id: top.id,
    type: top.type,
    name: top.title,
    isAnime: true,
    externalIds: top.externalIds,
  };

  void provider
    .listEpisodes(
      {
        title,
        audioPreference: input.audioPreference,
        subtitlePreference: input.subtitlePreference,
      },
      input.signal,
    )
    .catch(() => undefined);
}
