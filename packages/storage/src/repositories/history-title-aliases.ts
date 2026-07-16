import type { ProviderExternalIds } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

/**
 * Alias index for history title identity: any known external id (catalog or
 * provider-native) maps to the canonical history `title_id`. This is what lets
 * the same work found via AniList, TMDB, or an opaque provider id collapse to
 * one continue-watching unit. See .plans/catalog-identity-parity.md Phase 0.
 */
export type HistoryTitleAliasNs =
  | "anilist"
  | "mal"
  | "tmdb"
  | "imdb"
  | "youtube"
  | `provider:${string}`;

export interface HistoryTitleAliasInput {
  readonly ns: HistoryTitleAliasNs;
  readonly id: string;
}

export interface HistoryTitleAlias extends HistoryTitleAliasInput {
  readonly titleId: string;
}

interface HistoryTitleAliasRow {
  readonly alias_ns: string;
  readonly alias_id: string;
  readonly title_id: string;
}

export class HistoryTitleAliasRepository {
  constructor(private readonly db: KunaiDatabase) {}

  /** Point every alias at the canonical title id; an existing alias is repointed. */
  upsertAliases(
    titleId: string,
    aliases: readonly HistoryTitleAliasInput[],
    now = new Date().toISOString(),
  ): void {
    const statement = this.db.query(
      `
        INSERT INTO history_title_aliases (alias_ns, alias_id, title_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(alias_ns, alias_id) DO UPDATE SET
          title_id = excluded.title_id,
          updated_at = excluded.updated_at
      `,
    );
    for (const alias of aliases) {
      const id = alias.id.trim();
      if (!id) continue;
      statement.run(alias.ns, id, titleId, now, now);
    }
  }

  lookupTitleId(ns: HistoryTitleAliasNs, id: string): string | undefined {
    const row = this.db
      .query<Pick<HistoryTitleAliasRow, "title_id">, [string, string]>(
        "SELECT title_id FROM history_title_aliases WHERE alias_ns = ? AND alias_id = ?",
      )
      .get(ns, id);
    return row?.title_id ?? undefined;
  }

  listByTitleId(titleId: string): readonly HistoryTitleAlias[] {
    return this.db
      .query<HistoryTitleAliasRow, [string]>(
        "SELECT alias_ns, alias_id, title_id FROM history_title_aliases WHERE title_id = ?",
      )
      .all(titleId)
      .map((row) => ({
        ns: row.alias_ns as HistoryTitleAliasNs,
        id: row.alias_id,
        titleId: row.title_id,
      }));
  }

  /** Move every alias from a merged-away title id onto the surviving one. */
  reassignTitleId(oldTitleId: string, newTitleId: string, now = new Date().toISOString()): void {
    this.db
      .query(
        `
          UPDATE OR REPLACE history_title_aliases
          SET title_id = ?, updated_at = ?
          WHERE title_id = ?
        `,
      )
      .run(newTitleId, now, oldTitleId);
  }
}

/** Project an external id bag into alias rows (empty ids dropped). */
export function externalIdsToAliases(
  externalIds: ProviderExternalIds | undefined,
): readonly HistoryTitleAliasInput[] {
  if (!externalIds) return [];
  const aliases: HistoryTitleAliasInput[] = [];
  if (externalIds.anilistId) aliases.push({ ns: "anilist", id: externalIds.anilistId });
  if (externalIds.malId) aliases.push({ ns: "mal", id: externalIds.malId });
  if (externalIds.tmdbId) aliases.push({ ns: "tmdb", id: externalIds.tmdbId });
  if (externalIds.imdbId) aliases.push({ ns: "imdb", id: externalIds.imdbId });
  if (externalIds.youtubeId) aliases.push({ ns: "youtube", id: externalIds.youtubeId });
  for (const [providerId, nativeId] of Object.entries(externalIds.providerNativeIds ?? {})) {
    if (!nativeId?.trim()) continue;
    aliases.push({ ns: `provider:${providerId}`, id: nativeId.trim() });
  }
  return aliases;
}
