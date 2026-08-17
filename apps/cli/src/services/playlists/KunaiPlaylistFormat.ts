import { sanitizeProviderHints, type MediaProviderHint } from "@/domain/media/media-item-identity";
import type { ProviderExternalIds } from "@kunai/types";

export interface KunaiPlaylistExportInput {
  readonly playlist: {
    readonly id?: string;
    readonly name: string;
    readonly createdAt?: string;
  };
  readonly items: readonly {
    readonly titleId: string;
    readonly mediaKind: string;
    readonly contentType?: "movie" | "series";
    readonly externalIds?: ProviderExternalIds;
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
    readonly contentType?: "movie" | "series";
    readonly externalIds?: ProviderExternalIds;
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
      contentType: item.contentType,
      externalIds: item.externalIds,
      title: item.title,
      season: item.season,
      episode: item.episode,
      sortOrder: item.sortOrder,
      providerHints: sanitizeProviderHints(item.providerHints),
      progressPercent: item.progressPercent,
    })),
  };
}

function unresolvedImportedTitleId(titleId: string): string {
  return titleId.startsWith("imported-unresolved:") ? titleId : `imported-unresolved:${titleId}`;
}

export function importKunaiPlaylist(document: KunaiPlaylistDocument): ImportedKunaiPlaylist {
  return {
    playlist: document.playlist,
    items: document.items.map((item) => ({
      titleId: unresolvedImportedTitleId(item.titleId),
      mediaKind: item.mediaKind,
      contentType: item.contentType,
      title: item.title,
      season: item.season,
      episode: item.episode,
      sortOrder: item.sortOrder,
      providerHints: sanitizeProviderHints(item.providerHints),
      progressPercent: item.progressPercent,
      // Exchange files are untrusted. Catalogue ids become authoritative for
      // tracker mutations, so imported ids must be re-resolved locally before
      // they can ever be promoted into persisted identity.
      resolved: false,
      canAutoplay: false,
    })),
  };
}
