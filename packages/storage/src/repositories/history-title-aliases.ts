import type { ProviderExternalIds } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

/**
 * Alias index for history title identity: any known external id (catalog or
 * provider-native) maps to the canonical history `title_id`. This is what lets
 * the same work found via AniList, TMDB, or an opaque provider id collapse to
 * one continue-watching unit. Rationale: the archived
 * `.archive/plans/catalog-identity-parity.md` Phase 0 (history, not current spec).
 */
export type HistoryTitleAliasNs =
  | "anilist"
  | "mal"
  | "tmdb"
  | "imdb"
  | "youtube"
  | "youtube-channel"
  | "youtube-playlist"
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
    if (aliases.length === 0) return;
    this.db.transaction(() => {
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
    })();
  }

  lookupTitleId(ns: HistoryTitleAliasNs, id: string): string | undefined {
    const row = this.db
      .query<Pick<HistoryTitleAliasRow, "title_id">, [string, string]>(
        "SELECT title_id FROM history_title_aliases WHERE alias_ns = ? AND alias_id = ?",
      )
      .get(ns, id);
    return row?.title_id ?? undefined;
  }

  /** Resolve any alias row that points this raw id at a canonical title_id. */
  lookupTitleIdByAliasId(
    id: string,
    allowedNamespaces?: readonly HistoryTitleAliasNs[],
  ): string | undefined {
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    if (allowedNamespaces && allowedNamespaces.length > 0) {
      const placeholders = allowedNamespaces.map(() => "?").join(", ");
      const row = this.db
        .query<Pick<HistoryTitleAliasRow, "title_id">, [string, ...string[]]>(
          `SELECT title_id FROM history_title_aliases WHERE alias_id = ? AND alias_ns IN (${placeholders}) LIMIT 1`,
        )
        .get(trimmed, ...allowedNamespaces);
      return row?.title_id ?? undefined;
    }
    const rows = this.db
      .query<Pick<HistoryTitleAliasRow, "title_id">, [string]>(
        "SELECT title_id FROM history_title_aliases WHERE alias_id = ? LIMIT 2",
      )
      .all(trimmed);
    const first = rows[0];
    const second = rows[1];
    if (!first) return undefined;
    if (second && first.title_id !== second.title_id) {
      // Conflicting title_ids for the same raw id across different namespaces:
      // fail closed to prevent merging unrelated works in History.
      return undefined;
    }
    return first.title_id;
  }

  /**
   * Bulk form of `lookupTitleId` for identity resolution: one round-trip for
   * N (ns, id) pairs instead of one query per alias on the resume path.
   * Returns the title_id per pair that has a row, keyed by pair index.
   */
  lookupTitleIds(
    pairs: readonly (readonly [ns: HistoryTitleAliasNs, id: string])[],
  ): ReadonlyMap<number, string> {
    const found = new Map<number, string>();
    if (pairs.length === 0) return found;
    const values = pairs.map(() => "(?, ?)").join(", ");
    const params: string[] = [];
    for (const [ns, id] of pairs) params.push(ns, id);
    const rows = this.db
      .query<HistoryTitleAliasRow, string[]>(
        `SELECT alias_ns, alias_id, title_id FROM history_title_aliases WHERE (alias_ns, alias_id) IN (VALUES ${values})`,
      )
      .all(...params);
    const byPair = new Map(
      rows.map((row) => [`${row.alias_ns}\u0000${row.alias_id}`, row.title_id]),
    );
    pairs.forEach(([ns, id], index) => {
      const titleId = byPair.get(`${ns}\u0000${id}`);
      if (titleId !== undefined) found.set(index, titleId);
    });
    return found;
  }

  /**
   * Bulk form of `lookupTitleIdByAliasId`: one round-trip for N raw ids.
   * Fails closed if multiple conflicting canonical title_ids exist for a single raw id.
   */
  lookupTitleIdsByAliasId(ids: readonly string[]): ReadonlyMap<string, string> {
    const found = new Map<string, string>();
    const trimmed = [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (trimmed.length === 0) return found;
    const placeholders = trimmed.map(() => "?").join(", ");
    const rows = this.db
      .query<HistoryTitleAliasRow, string[]>(
        `SELECT alias_ns, alias_id, title_id FROM history_title_aliases WHERE alias_id IN (${placeholders})`,
      )
      .all(...trimmed);
    const byId = new Map<string, string[]>();
    for (const row of rows) {
      const list = byId.get(row.alias_id) ?? [];
      list.push(row.title_id);
      byId.set(row.alias_id, list);
    }
    for (const [aliasId, titleIds] of byId) {
      const distinct = new Set(titleIds);
      const firstId = titleIds[0];
      if (distinct.size === 1 && firstId !== undefined) {
        found.set(aliasId, firstId);
      }
    }
    return found;
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
  if (externalIds.youtubeChannelId)
    aliases.push({ ns: "youtube-channel", id: externalIds.youtubeChannelId });
  if (externalIds.youtubePlaylistId)
    aliases.push({ ns: "youtube-playlist", id: externalIds.youtubePlaylistId });
  for (const [providerId, nativeId] of Object.entries(externalIds.providerNativeIds ?? {})) {
    if (!nativeId?.trim()) continue;
    aliases.push({ ns: `provider:${providerId}`, id: nativeId.trim() });
  }
  return aliases;
}
