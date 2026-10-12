// =============================================================================
// collect-local-titles.ts — repository glue for the universal `/` palette.
//
// Runs ONCE per palette open: bulk repository reads into an in-memory entry
// list, deduped by normalized title. The per-keystroke matcher then only ever
// walks this list — no SQLite hit per typed character.
//
// Source precedence decides which row survives dedupe: history first (richest
// launch anchor — provider, position, external ids), then queue, followed,
// lists, playlists.
// =============================================================================

import { dedupeLocalTitleEntries, type LocalTitleEntry } from "@/domain/palette/local-title-index";
import type { QueueService } from "@/domain/queue/QueueService";
import { isPlaceholderTitleName } from "@/domain/types";
import {
  correctedHistoryMediaKind,
  historyContentType,
  historyEpisodeLabel,
} from "@/services/continuation/history-progress";
import type {
  FollowedTitleRepository,
  HistoryRepository,
  ListRepository,
  PlaylistsRepository,
} from "@kunai/storage";
import type { MediaKind } from "@kunai/types";

export type LocalTitleRepos = {
  readonly historyRepository: Pick<HistoryRepository, "listLatestByTitle">;
  readonly followedTitleRepository: Pick<FollowedTitleRepository, "listByPreference">;
  readonly listRepository: Pick<ListRepository, "getLists" | "getItems">;
  readonly playlistsRepository: Pick<PlaylistsRepository, "list" | "listItems">;
  readonly queueService: Pick<QueueService, "getUnplayed">;
};

const toMillis = (value?: string | null): number => {
  if (!value) return 0;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
};

const seasonEpisodeDetail = (
  season?: number,
  episode?: number,
  absoluteEpisode?: number,
): string | null => {
  if (typeof season === "number" && typeof episode === "number") {
    return `S${season} E${episode}`;
  }
  if (typeof episode === "number") return `E${episode}`;
  if (typeof absoluteEpisode === "number") return `E${absoluteEpisode}`;
  return null;
};

export function collectLocalTitleEntries(repos: LocalTitleRepos): LocalTitleEntry[] {
  const entries: LocalTitleEntry[] = [];

  for (const row of repos.historyRepository.listLatestByTitle(500)) {
    if (isPlaceholderTitleName(row.title, row.titleId)) continue;
    const contentType = historyContentType(row);
    entries.push({
      titleId: row.titleId,
      mediaKind: correctedHistoryMediaKind(row),
      contentType,
      title: row.title,
      source: "history",
      ...(row.providerId ? { providerId: row.providerId } : {}),
      ...(row.externalIds ? { externalIds: row.externalIds } : {}),
      ...(row.season !== undefined ? { season: row.season } : {}),
      ...(row.episode !== undefined ? { episode: row.episode } : {}),
      ...(row.absoluteEpisode !== undefined ? { absoluteEpisode: row.absoluteEpisode } : {}),
      historyEntry: row,
      recency: toMillis(row.lastWatchedAt ?? row.updatedAt),
      detail: [historyEpisodeLabel(row), "history"].filter(Boolean).join(" · "),
    });
  }

  for (const entry of repos.queueService.getUnplayed()) {
    if (isPlaceholderTitleName(entry.title, entry.titleId)) continue;
    const episodePart =
      entry.contentType !== "movie"
        ? seasonEpisodeDetail(entry.season, entry.episode, entry.absoluteEpisode)
        : null;
    entries.push({
      titleId: entry.titleId,
      mediaKind: entry.mediaKind as MediaKind,
      ...(entry.contentType ? { contentType: entry.contentType } : {}),
      title: entry.title,
      source: "queue",
      ...(entry.externalIds ? { externalIds: entry.externalIds } : {}),
      ...(entry.season !== undefined ? { season: entry.season } : {}),
      ...(entry.episode !== undefined ? { episode: entry.episode } : {}),
      ...(entry.absoluteEpisode !== undefined ? { absoluteEpisode: entry.absoluteEpisode } : {}),
      queueEntryId: entry.id,
      recency: toMillis(entry.addedAt),
      detail: [episodePart, "queued"].filter(Boolean).join(" · "),
    });
  }

  for (const preference of ["following", "implicit"] as const) {
    for (const record of repos.followedTitleRepository.listByPreference(preference)) {
      if (isPlaceholderTitleName(record.title, record.titleId)) continue;
      entries.push({
        titleId: record.titleId,
        mediaKind: record.mediaKind as MediaKind,
        title: record.title,
        source: "followed",
        recency: toMillis(record.updatedAt),
        detail: "following",
      });
    }
  }

  for (const list of repos.listRepository.getLists()) {
    for (const item of repos.listRepository.getItems(list.id)) {
      if (isPlaceholderTitleName(item.title, item.titleId)) continue;
      const episodePart =
        item.contentType !== "movie" ? seasonEpisodeDetail(item.season, item.episode) : null;
      entries.push({
        titleId: item.titleId,
        mediaKind: item.mediaKind as MediaKind,
        ...(item.contentType ? { contentType: item.contentType } : {}),
        title: item.title,
        source: "list",
        ...(item.externalIds ? { externalIds: item.externalIds } : {}),
        ...(item.season !== undefined ? { season: item.season } : {}),
        ...(item.episode !== undefined ? { episode: item.episode } : {}),
        recency: toMillis(item.addedAt),
        detail: [episodePart, list.name].filter(Boolean).join(" · "),
      });
    }
  }

  for (const playlist of repos.playlistsRepository.list()) {
    for (const item of repos.playlistsRepository.listItems(playlist.id)) {
      if (isPlaceholderTitleName(item.title, item.titleId)) continue;
      const episodePart =
        item.contentType !== "movie"
          ? seasonEpisodeDetail(item.season, item.episode, item.absoluteEpisode)
          : null;
      entries.push({
        titleId: item.titleId,
        mediaKind: item.mediaKind as MediaKind,
        ...(item.contentType ? { contentType: item.contentType } : {}),
        title: item.title,
        source: "playlist",
        ...(item.externalIds ? { externalIds: item.externalIds } : {}),
        ...(item.season !== undefined ? { season: item.season } : {}),
        ...(item.episode !== undefined ? { episode: item.episode } : {}),
        ...(item.absoluteEpisode !== undefined ? { absoluteEpisode: item.absoluteEpisode } : {}),
        recency: toMillis(item.addedAt),
        detail: [episodePart, playlist.name].filter(Boolean).join(" · "),
      });
    }
  }

  return dedupeLocalTitleEntries(entries);
}
