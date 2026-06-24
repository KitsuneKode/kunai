import { openChecklistShell, type ListOption } from "@/app-shell/checklist-shell";
import { chooseSeasonFromOptions } from "@/app-shell/pickers";
import { buildPickerActionContext } from "@/app-shell/workflows";
import type { Container } from "@/container";
import type { EpisodeInfo, EpisodePickerOption, TitleInfo } from "@/domain/types";
import { fetchEpisodes, fetchSeriesData } from "@/tmdb";

function dedupeEpisodes(episodes: readonly EpisodeInfo[]): EpisodeInfo[] {
  const seen = new Set<string>();
  const out: EpisodeInfo[] = [];
  for (const ep of episodes) {
    const key = `${ep.season}:${ep.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ep);
  }
  return out;
}

function animeOptionsFromProviderList(
  episodes: readonly EpisodePickerOption[],
): ListOption<EpisodeInfo>[] {
  return episodes.map((ep) => ({
    value: { season: 1, episode: ep.index, name: ep.name ?? ep.label },
    label: ep.label,
    detail: ep.detail,
  }));
}

function animeOptionsFromCount(episodeCount: number): ListOption<EpisodeInfo>[] {
  const out: ListOption<EpisodeInfo>[] = [];
  for (let e = 1; e <= episodeCount; e += 1) {
    out.push({
      value: { season: 1, episode: e },
      label: `Episode ${e}`,
    });
  }
  return out;
}

export async function pickEpisodesToDownload(args: {
  readonly title: TitleInfo;
  readonly isAnime: boolean;
  readonly animeEpisodes: readonly EpisodePickerOption[] | null | undefined;
  readonly container: Container;
}): Promise<readonly EpisodeInfo[] | null> {
  const { title, isAnime, animeEpisodes, container } = args;

  if (title.type === "movie") {
    return [{ season: 1, episode: 1 }];
  }

  const actionContext = buildPickerActionContext({
    container,
    taskLabel: "Choose episodes to download",
  });

  let options: ListOption<EpisodeInfo>[] = [];

  if (isAnime) {
    if (animeEpisodes && animeEpisodes.length > 0) {
      options = animeOptionsFromProviderList(animeEpisodes);
    } else if (title.episodeCount && title.episodeCount > 0) {
      options = animeOptionsFromCount(title.episodeCount);
    } else {
      return null;
    }
  } else {
    const { seasons, episodes: firstSeasonEps } = await fetchSeriesData(title.id, 1);
    if (!seasons || seasons.length === 0) {
      return null;
    }
    const season = await chooseSeasonFromOptions(seasons, 1, actionContext, container);
    if (!season) {
      return null;
    }
    const episodes = season === 1 ? firstSeasonEps : await fetchEpisodes(title.id, season);
    if (!episodes || episodes.length === 0) {
      return null;
    }
    options = episodes.map((ep) => ({
      value: { season, episode: ep.number, name: ep.name, airDate: ep.airDate },
      label: `E${ep.number}${ep.name ? ` · ${ep.name}` : ""}`,
      detail: ep.airDate,
    }));
  }

  if (options.length === 0) {
    return null;
  }

  const picked = await openChecklistShell({
    title: `Download · ${title.name}`,
    subtitle: `${options.length} episode(s) · Space toggle · Ctrl+A all · Enter confirm`,
    options,
  });

  if (!picked || picked.length === 0) {
    return null;
  }

  return dedupeEpisodes(picked);
}
