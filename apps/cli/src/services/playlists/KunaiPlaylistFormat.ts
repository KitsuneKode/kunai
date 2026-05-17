import { sanitizeProviderHints, type MediaProviderHint } from "@/domain/media/media-item-identity";

export interface KunaiPlaylistExportInput {
  readonly playlist: {
    readonly id?: string;
    readonly name: string;
    readonly createdAt?: string;
  };
  readonly items: readonly {
    readonly titleId: string;
    readonly mediaKind: string;
    readonly title: string;
    readonly season?: number;
    readonly episode?: number;
    readonly sortOrder: number;
    readonly providerHints?: readonly (
      | MediaProviderHint
      | (MediaProviderHint & Record<string, unknown>)
    )[];
    readonly progressPercent?: number;
  }[];
  readonly exportedAt?: string;
}

export interface KunaiPlaylistDocument {
  readonly format: "kunai-playlist";
  readonly version: 1;
  readonly exportedAt: string;
  readonly playlist: {
    readonly name: string;
    readonly createdAt?: string;
  };
  readonly items: readonly {
    readonly titleId: string;
    readonly mediaKind: string;
    readonly title: string;
    readonly season?: number;
    readonly episode?: number;
    readonly sortOrder: number;
    readonly providerHints: readonly MediaProviderHint[];
    readonly progressPercent?: number;
  }[];
}

export interface ImportedKunaiPlaylist {
  readonly playlist: KunaiPlaylistDocument["playlist"];
  readonly items: readonly (KunaiPlaylistDocument["items"][number] & {
    readonly resolved: boolean;
    readonly canAutoplay: boolean;
  })[];
}

export function exportKunaiPlaylist(input: KunaiPlaylistExportInput): KunaiPlaylistDocument {
  return {
    format: "kunai-playlist",
    version: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    playlist: {
      name: input.playlist.name,
      createdAt: input.playlist.createdAt,
    },
    items: input.items.map((item) => ({
      titleId: item.titleId,
      mediaKind: item.mediaKind,
      title: item.title,
      season: item.season,
      episode: item.episode,
      sortOrder: item.sortOrder,
      providerHints: sanitizeProviderHints(item.providerHints),
      progressPercent: item.progressPercent,
    })),
  };
}

export function importKunaiPlaylist(document: KunaiPlaylistDocument): ImportedKunaiPlaylist {
  return {
    playlist: document.playlist,
    items: document.items.map((item) => ({
      ...item,
      providerHints: sanitizeProviderHints(item.providerHints),
      resolved: false,
      canAutoplay: false,
    })),
  };
}
