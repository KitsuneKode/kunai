// =============================================================================
// Provider-native episode catalog for playback
//
// Loads the provider's episode list (anime/YouTube series) with the same
// language context the resolve uses, cached per provider/title/audio for the
// phase. Failed or aborted loads are never cached.
// =============================================================================

import { animeEpisodeCatalogCacheKey } from "@/app/playback/playback-episode-picker";
import { type EpisodeCatalogLanguagePreferences } from "@/app/playback/playback-profile-context";
import type { EpisodePickerOption, ShellMode, TitleInfo } from "@/domain/types";
import type { Provider } from "@/services/providers/Provider";

export async function getAnimeEpisodeOptions({
  title,
  mode,
  provider,
  cache,
  languages,
  signal,
}: {
  title: TitleInfo;
  mode: ShellMode;
  provider: Provider | undefined;
  cache: Map<string, readonly EpisodePickerOption[] | undefined>;
  languages: EpisodeCatalogLanguagePreferences;
  signal?: AbortSignal;
}): Promise<readonly EpisodePickerOption[] | undefined> {
  const cacheKey = animeEpisodeCatalogCacheKey({
    providerId: provider?.metadata.id,
    titleId: title?.id,
    audioPreference: languages.audioPreference,
  });
  if (cacheKey && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const result = await loadAnimeEpisodeOptions(title, mode, provider, languages, signal);
  // Never cache a failed/aborted load: a cancelled resolve would otherwise
  // pin the episode picker to its 1-entry fallback for the whole session.
  if (cacheKey && result !== undefined) {
    cache.set(cacheKey, result);
  }
  return result;
}

async function loadAnimeEpisodeOptions(
  title: TitleInfo,
  mode: ShellMode,
  provider: Provider | undefined,
  languages: EpisodeCatalogLanguagePreferences,
  signal?: AbortSignal,
): Promise<readonly EpisodePickerOption[] | undefined> {
  if (
    (mode !== "anime" && mode !== "youtube") ||
    title.type !== "series" ||
    !provider?.listEpisodes
  ) {
    return undefined;
  }

  try {
    // Same language context `resolve` gets. Omitting it made AllAnime's
    // `resolveAnimeAudioIntent` fall back to sub, so dub users browsed a sub
    // episode list and then played dub — mismatched counts and labels.
    return (
      (await provider.listEpisodes(
        {
          title,
          audioPreference: languages.audioPreference,
          subtitlePreference: languages.subtitlePreference,
        },
        signal,
      )) ?? undefined
    );
  } catch {
    return undefined;
  }
}
