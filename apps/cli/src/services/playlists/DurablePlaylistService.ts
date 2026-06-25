import type { MediaProviderHint } from "@/domain/media/media-item-identity";
import type { QueueService } from "@/domain/queue/QueueService";
import type { PlaylistsRepository, UserPlaylistRecord } from "@kunai/storage";

import {
  exportKunaiPlaylist,
  importKunaiPlaylist,
  type KunaiPlaylistDocument,
  type KunaiPlaylistExportInput,
} from "./KunaiPlaylistFormat";
import type { PlaylistProgressProjectionInput } from "./PlaylistProjectionService";
import { projectPlaylistItems } from "./PlaylistProjectionService";

export interface DurablePlaylistClock {
  readonly now: () => string;
  readonly id: (prefix: string) => string;
}

export interface DurablePlaylistItemInput {
  readonly titleId: string;
  readonly mediaKind: string;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly providerHints?: readonly (
    | MediaProviderHint
    | (MediaProviderHint & Record<string, unknown>)
  )[];
  readonly notes?: string;
}

export class DurablePlaylistService {
  constructor(
    private readonly repo: PlaylistsRepository,
    private readonly clock: DurablePlaylistClock = {
      now: () => new Date().toISOString(),
      id: (prefix) => `${prefix}-${crypto.randomUUID()}`,
    },
  ) {}

  createPlaylist(name: string, description?: string): UserPlaylistRecord {
    const now = this.clock.now();
    return this.repo.create({
      id: this.clock.id("playlist"),
      name,
      description,
      createdAt: now,
      updatedAt: now,
    });
  }

  listPlaylists(): UserPlaylistRecord[] {
    return this.repo.list();
  }

  listItems(playlistId: string) {
    return this.repo.listItems(playlistId);
  }

  addItem(playlistId: string, input: DurablePlaylistItemInput): void {
    const items = this.repo.listItems(playlistId);
    this.repo.addItem({
      id: this.clock.id("playlist-item"),
      playlistId,
      titleId: input.titleId,
      mediaKind: input.mediaKind,
      title: input.title,
      season: input.season,
      episode: input.episode,
      absoluteEpisode: input.absoluteEpisode,
      sortOrder: items.length,
      providerHintsJson: JSON.stringify(input.providerHints ?? []),
      notes: input.notes,
      addedAt: this.clock.now(),
    });
  }

  exportPlaylist(
    playlistId: string,
    name: string,
    progress: readonly PlaylistProgressProjectionInput[],
  ): KunaiPlaylistDocument {
    const items = this.repo.listItems(playlistId);
    const projected = projectPlaylistItems({
      items: items.map((item) => ({
        id: item.id,
        playlistId: item.playlistId,
        titleId: item.titleId,
        mediaKind: item.mediaKind,
        title: item.title,
        season: item.season,
        episode: item.episode,
        sortOrder: item.sortOrder,
        addedAt: item.addedAt,
      })),
      progress,
    });

    const exportItems: KunaiPlaylistExportInput["items"] = items.map((item) => {
      const progressItem = projected.find((candidate) => candidate.id === item.id);
      return {
        titleId: item.titleId,
        mediaKind: item.mediaKind,
        title: item.title,
        season: item.season,
        episode: item.episode,
        sortOrder: item.sortOrder,
        providerHints: parseProviderHints(item.providerHintsJson),
        progressPercent: progressItem?.progressPercent,
      };
    });

    return exportKunaiPlaylist({
      playlist: { id: playlistId, name },
      items: exportItems,
      exportedAt: this.clock.now(),
    });
  }

  loadIntoQueue(queueService: QueueService, playlistId: string): number {
    const items = [...this.repo.listItems(playlistId)].sort(
      (left, right) => left.sortOrder - right.sortOrder,
    );
    for (const item of items) {
      queueService.enqueue({
        title: item.title,
        mediaKind: item.mediaKind,
        titleId: item.titleId,
        season: item.season,
        episode: item.episode,
        absoluteEpisode: item.absoluteEpisode,
        source: "durable-playlist",
      });
    }
    return items.length;
  }

  importPlaylist(document: KunaiPlaylistDocument): UserPlaylistRecord {
    const imported = importKunaiPlaylist(document);
    const playlist = this.createPlaylist(imported.playlist.name, "Imported Kunai playlist");
    for (const item of [...imported.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
      this.addItem(playlist.id, {
        titleId: item.titleId,
        mediaKind: item.mediaKind,
        title: item.title,
        season: item.season,
        episode: item.episode,
        providerHints: item.providerHints,
      });
    }
    return playlist;
  }
}

function parseProviderHints(value: string | undefined): readonly MediaProviderHint[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((hint): hint is Record<string, unknown> => Boolean(hint) && typeof hint === "object")
      .flatMap((hint) =>
        typeof hint.providerId === "string"
          ? [
              {
                providerId: hint.providerId,
                sourceId: typeof hint.sourceId === "string" ? hint.sourceId : undefined,
                qualityLabel: typeof hint.qualityLabel === "string" ? hint.qualityLabel : undefined,
              },
            ]
          : [],
      );
  } catch {
    return [];
  }
}
