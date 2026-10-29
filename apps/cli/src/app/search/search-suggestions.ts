// =============================================================================
// search-suggestions.ts — materialize the suggestion band's two sources.
//
// Local layer (0ms, synchronous SQLite reads): watched titles, followed titles,
// and lists/playlists rows become `SearchSuggestion<SearchResult>` entries whose
// `value` is a synthesized SearchResult — committing one goes through the exact
// same onSubmit path as a catalog row, so episode/provider resolution is
// unchanged. Remote rows arrive already mapped by {@link toCatalogSuggestions}.
//
// Every read is best-effort: a broken source contributes nothing rather than
// breaking the band.
// =============================================================================

import type { Container } from "@/container";
import { shellModeToProviderLane, storedTitleProviderLane } from "@/domain/provider-lane";
import type { SearchSuggestion } from "@/domain/search/suggestion-engine";
import type { ProviderLane, SearchResult, ShellMode } from "@/domain/types";
import {
  correctedHistoryMediaKind,
  historyContentType,
  historyEpisodeLabel,
  historyProviderLane,
  isFinished,
  isYoutubeHistoryEntry,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import type { HistoryProgress, ListItem, UserPlaylistItemRecord } from "@kunai/storage";

import { chooseSearchResultTitle } from "./browse-option-mappers";

type CorpusSource = {
  readonly historyRepository: Parameters<typeof readLatestHistoryByTitle>[0];
  readonly followedTitleRepository: Pick<Container["followedTitleRepository"], "listByPreference">;
  readonly listService: Pick<
    Container["listService"],
    "getFavorites" | "getWatchlist" | "getListItems"
  >;
  readonly listRepository: Pick<Container["listRepository"], "getLists">;
  readonly playlistsRepository: Pick<Container["playlistsRepository"], "list" | "listItems">;
};

const CORPUS_BOUNDS = {
  watched: 60,
  followed: 40,
  perList: 40,
  lists: 8,
  playlists: 8,
  perPlaylist: 40,
} as const;

function kindLabel(mediaKind: string): string {
  if (mediaKind === "anime") return "Anime";
  if (mediaKind === "movie") return "Movie";
  if (mediaKind === "video") return "Video";
  return "Series";
}

function epochMs(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * A history row becomes a full-lane SearchResult so Enter on it behaves like
 * picking that title from the result list (session routing + episode flow).
 * `resolvedLane` is stamped from the row so a pick under a different mode
 * still replays in the lane the row was watched in.
 */
function searchResultFromHistory(row: HistoryProgress): SearchResult {
  const kind = correctedHistoryMediaKind(row);
  const lane = historyProviderLane(row);
  return {
    id: row.titleId,
    type: historyContentType(row),
    title: row.title,
    year: "",
    overview: "",
    posterPath: row.posterUrl ?? null,
    externalIds: row.externalIds,
    isAnime: kind === "anime" ? true : undefined,
    resultKind: isYoutubeHistoryEntry(row) ? "video" : undefined,
    resolvedLane: lane,
    metadataSource: "Local history",
  };
}

/** Stored primary kind owns routing; linked catalog ids remain eligibility metadata. */
function searchResultFromStoredTitle(input: {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: string;
  readonly contentType?: "movie" | "series";
  readonly externalIds?: SearchResult["externalIds"];
}): SearchResult {
  return {
    id: input.titleId,
    type: input.contentType ?? (input.mediaKind === "movie" ? "movie" : "series"),
    title: input.title,
    year: "",
    overview: "",
    posterPath: null,
    externalIds: input.externalIds,
    isAnime: input.mediaKind === "anime" ? true : undefined,
    resultKind: input.mediaKind === "video" ? "video" : undefined,
    resolvedLane: storedTitleProviderLane(input),
    metadataSource: "Local library",
  };
}

function watchedSuggestion(row: HistoryProgress): SearchSuggestion<SearchResult> {
  const kind = correctedHistoryMediaKind(row);
  const ep = historyEpisodeLabel(row);
  return {
    id: `watched:${row.titleId}`,
    title: row.title,
    source: "watched",
    badge: isFinished(row) ? "watched" : "continue",
    meta: [kindLabel(kind), ep ?? ""].filter(Boolean).join(" · "),
    recencyMs: epochMs(row.updatedAt),
    value: searchResultFromHistory(row),
  };
}

function listItemSuggestion(item: ListItem, badge: string): SearchSuggestion<SearchResult> {
  return {
    id: `list:${item.listId}:${item.titleId}`,
    title: item.title,
    source: "list",
    badge,
    meta: kindLabel(item.mediaKind),
    recencyMs: epochMs(item.addedAt),
    value: searchResultFromStoredTitle(item),
  };
}

function playlistItemSuggestion(
  item: UserPlaylistItemRecord,
  playlistName: string,
): SearchSuggestion<SearchResult> {
  return {
    id: `playlist:${item.playlistId}:${item.id}`,
    title: item.title,
    source: "playlist",
    badge: playlistName,
    meta: kindLabel(item.mediaKind),
    recencyMs: epochMs(item.addedAt),
    value: searchResultFromStoredTitle(item),
  };
}

/**
 * Snapshot of the local corpus. Dedupe by titleId keeps the strongest
 * provenance: a row that is both watched and favourited keeps the watched
 * badge (resume intent beats a membership flag).
 */
export function loadLocalSuggestionCorpus(
  source: CorpusSource,
  mode?: ShellMode,
): readonly SearchSuggestion<SearchResult>[] {
  const byTitleId = new Map<string, SearchSuggestion<SearchResult>>();
  const takeInMode = <T>(
    rows: readonly T[],
    lane: (row: T) => ProviderLane,
    limit: number,
  ): readonly T[] =>
    (mode ? rows.filter((row) => lane(row) === shellModeToProviderLane(mode)) : rows).slice(
      0,
      limit,
    );
  const storedLane = storedTitleProviderLane;
  const push = (suggestion: SearchSuggestion<SearchResult>, titleId: string) => {
    if (mode && suggestion.value?.resolvedLane !== shellModeToProviderLane(mode)) return;
    if (!byTitleId.has(titleId)) byTitleId.set(titleId, suggestion);
  };

  try {
    for (const row of takeInMode(
      Object.values(
        readLatestHistoryByTitle(
          source.historyRepository,
          mode ? shellModeToProviderLane(mode) : undefined,
        ),
      ),
      historyProviderLane,
      CORPUS_BOUNDS.watched,
    )) {
      push(watchedSuggestion(row), row.titleId);
    }
  } catch {
    // best-effort source
  }

  try {
    for (const item of takeInMode(
      source.listService.getFavorites(),
      storedLane,
      CORPUS_BOUNDS.perList,
    )) {
      push(listItemSuggestion(item, "♥ your list"), item.titleId);
    }
    for (const item of takeInMode(
      source.listService.getWatchlist(),
      storedLane,
      CORPUS_BOUNDS.perList,
    )) {
      push(listItemSuggestion(item, "watchlist"), item.titleId);
    }
  } catch {
    // best-effort source
  }

  try {
    for (const record of takeInMode(
      source.followedTitleRepository.listByPreference("following"),
      storedLane,
      CORPUS_BOUNDS.followed,
    )) {
      push(
        {
          id: `followed:${record.titleId}`,
          title: record.title,
          source: "followed",
          badge: "following",
          meta: kindLabel(record.mediaKind),
          recencyMs: epochMs(record.updatedAt),
          value: searchResultFromStoredTitle(record),
        },
        record.titleId,
      );
    }
  } catch {
    // best-effort source
  }

  try {
    for (const list of source.listRepository.getLists().slice(0, CORPUS_BOUNDS.lists)) {
      if (list.id === "watchlist" || list.id === "favorites") continue;
      for (const item of takeInMode(
        source.listService.getListItems(list.id),
        storedLane,
        CORPUS_BOUNDS.perList,
      )) {
        push(listItemSuggestion(item, list.name), item.titleId);
      }
    }
  } catch {
    // best-effort source
  }

  try {
    for (const playlist of source.playlistsRepository.list().slice(0, CORPUS_BOUNDS.playlists)) {
      for (const item of takeInMode(
        source.playlistsRepository.listItems(playlist.id),
        storedLane,
        CORPUS_BOUNDS.perPlaylist,
      )) {
        push(playlistItemSuggestion(item, playlist.name), item.titleId);
      }
    }
  } catch {
    // best-effort source
  }

  return [...byTitleId.values()];
}

/** Map a fast-catalog result into a band row; `value` is the untouched result. */
export function toCatalogSuggestions(
  results: readonly SearchResult[],
  titlePreference: Parameters<typeof chooseSearchResultTitle>[1],
): readonly SearchSuggestion<SearchResult>[] {
  return results.map((result) => ({
    id: `catalog:${result.id}`,
    title: chooseSearchResultTitle(result, titlePreference),
    source: "catalog",
    meta: result.commitQuery
      ? "YouTube query"
      : [
          result.year || "",
          result.isAnime ? "Anime" : kindLabel(result.type === "movie" ? "movie" : "series"),
          result.episodeCount ? `${result.episodeCount} eps` : "",
        ]
          .filter(Boolean)
          .join(" · "),
    value: result,
    ...(result.commitQuery ? { commitQuery: result.commitQuery } : null),
  }));
}
