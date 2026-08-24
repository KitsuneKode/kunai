import { isPlaceholderTitleName, mergeBackfillExternalIds } from "@kunai/core";
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";
import { SyncReconciliationRepository } from "./sync-reconciliation";

export type ListKind = "watchlist" | "favorites" | "custom";

export interface KunaiList {
  readonly id: string;
  readonly name: string;
  readonly kind: ListKind;
  readonly color?: string;
  readonly icon?: string;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListItem {
  readonly id: string;
  readonly listId: string;
  readonly titleId: string;
  readonly mediaKind: string;
  readonly contentType?: "movie" | "series";
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly notes?: string;
  readonly externalIds?: ProviderExternalIds;
  readonly addedAt: string;
  readonly sortOrder: number;
}

export interface ListItemInput {
  readonly listId: string;
  readonly titleId: string;
  readonly mediaKind: string;
  readonly contentType?: "movie" | "series";
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly notes?: string;
  readonly externalIds?: ProviderExternalIds;
}

interface ListRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ListItemRow {
  readonly id: string;
  readonly list_id: string;
  readonly title_id: string;
  readonly media_kind: string;
  readonly content_type: string | null;
  readonly title: string;
  readonly season: number | null;
  readonly episode: number | null;
  readonly notes: string | null;
  readonly external_ids_json: string | null;
  readonly added_at: string;
  readonly sort_order: number;
}

function mapListRow(row: ListRow): KunaiList {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ListKind,
    color: row.color ?? undefined,
    icon: row.icon ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapListItemRow(row: ListItemRow): ListItem {
  return {
    id: row.id,
    listId: row.list_id,
    titleId: row.title_id,
    mediaKind: row.media_kind,
    contentType:
      row.content_type === "movie" || row.content_type === "series" ? row.content_type : undefined,
    title: row.title,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    notes: row.notes ?? undefined,
    externalIds: parseExternalIds(row.external_ids_json),
    addedAt: row.added_at,
    sortOrder: row.sort_order,
  };
}

export class ListRepository {
  private readonly syncReconciliation: SyncReconciliationRepository;

  constructor(private readonly db: KunaiDatabase) {
    this.syncReconciliation = new SyncReconciliationRepository(db);
  }

  getLists(): KunaiList[] {
    return this.db
      .query<ListRow, []>("SELECT * FROM lists ORDER BY sort_order ASC, created_at ASC")
      .all()
      .map(mapListRow);
  }

  getList(id: string): KunaiList | undefined {
    const row = this.db.query<ListRow, [string]>("SELECT * FROM lists WHERE id = ?").get(id);
    return row === null ? undefined : mapListRow(row);
  }

  createList(input: { name: string; kind: ListKind; color?: string; icon?: string }): KunaiList {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxOrder = this.db
      .query<{ max_order: number | null }, []>("SELECT MAX(sort_order) AS max_order FROM lists")
      .get();
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;

    this.db
      .query(
        `INSERT INTO lists (id, name, kind, color, icon, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.kind,
        input.color ?? null,
        input.icon ?? null,
        sortOrder,
        now,
        now,
      );

    const created = this.getList(id);
    if (!created) throw new Error(`List not found after insert: ${id}`);
    return created;
  }

  updateList(id: string, input: Partial<Pick<KunaiList, "name" | "color" | "icon">>): void {
    const now = new Date().toISOString();
    const current = this.getList(id);
    if (!current) return;

    this.db
      .query(`UPDATE lists SET name = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?`)
      .run(
        input.name ?? current.name,
        input.color !== undefined ? (input.color ?? null) : (current.color ?? null),
        input.icon !== undefined ? (input.icon ?? null) : (current.icon ?? null),
        now,
        id,
      );
  }

  deleteList(id: string): void {
    this.db.query("DELETE FROM lists WHERE id = ?").run(id);
  }

  getItems(listId: string): ListItem[] {
    return this.db
      .query<ListItemRow, [string]>(
        "SELECT * FROM list_items WHERE list_id = ? ORDER BY sort_order ASC, added_at ASC",
      )
      .all(listId)
      .map(mapListItemRow);
  }

  /**
   * Add a title to a list, or refresh the one already there.
   *
   * Membership is a set, so adding twice is not an error and must not store a
   * second row — `(list_id, title_id)` is unique and the conflict updates the
   * descriptive columns instead. `added_at` and `sort_order` are deliberately
   * left alone: re-adding something is not re-discovering it, and rewriting
   * either would silently reorder the user's list.
   */
  addItem(input: ListItemInput): ListItem {
    return this.db.transaction((value: ListItemInput) => this.addItemInTransaction(value))(input);
  }

  private addItemInTransaction(input: ListItemInput): ListItem {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Re-adding a title must never subtract from what the row already knows.
    // A caller holding only an id (a `-i/--id` launch before the catalog
    // answers) used to overwrite the stored name with its placeholder and null
    // the external ids that address the title's tracker entry. Same contract as
    // `history_progress`.
    const existing = this.getItemByTitle(input.listId, input.titleId);
    const title = resolvePersistedListTitle(input, existing);
    const externalIds = mergeBackfillExternalIds(existing?.externalIds, input.externalIds);
    const maxOrder = this.db
      .query<{ max_order: number | null }, [string]>(
        "SELECT MAX(sort_order) AS max_order FROM list_items WHERE list_id = ?",
      )
      .get(input.listId);
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;

    this.db
      .query(
        `INSERT INTO list_items (id, list_id, title_id, media_kind, content_type, title, season, episode, notes, external_ids_json, added_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(list_id, title_id) DO UPDATE SET
           media_kind = excluded.media_kind,
           content_type = excluded.content_type,
           title = excluded.title,
           season = excluded.season,
           episode = excluded.episode,
           notes = excluded.notes,
           external_ids_json = excluded.external_ids_json`,
      )
      .run(
        id,
        input.listId,
        input.titleId,
        input.mediaKind,
        input.contentType ?? null,
        title,
        input.season ?? null,
        input.episode ?? null,
        input.notes ?? null,
        serializeExternalIds(externalIds),
        now,
        sortOrder,
      );

    // Read back by (list, title) rather than by the generated id: on conflict
    // the surviving row keeps the id it was first inserted with.
    const row = this.db
      .query<ListItemRow, [string, string]>(
        "SELECT * FROM list_items WHERE list_id = ? AND title_id = ?",
      )
      .get(input.listId, input.titleId);
    if (!row) throw new Error(`List item not found after insert: ${input.listId}/${input.titleId}`);
    const stored = mapListItemRow(row);
    this.recordListReconciliation(stored, true, now);
    return stored;
  }

  removeItem(id: string): void {
    this.db.transaction((itemId: string) => {
      const row = this.db
        .query<ListItemRow, [string]>("SELECT * FROM list_items WHERE id = ?")
        .get(itemId);
      if (!row) return;
      this.db.query("DELETE FROM list_items WHERE id = ?").run(itemId);
      this.recordListReconciliation(mapListItemRow(row), false, new Date().toISOString());
    })(id);
  }

  removeItemByTitle(listId: string, titleId: string): void {
    this.db.transaction((list: string, title: string) => {
      const row = this.db
        .query<ListItemRow, [string, string]>(
          "SELECT * FROM list_items WHERE list_id = ? AND title_id = ?",
        )
        .get(list, title);
      if (!row) return;
      this.db.query("DELETE FROM list_items WHERE list_id = ? AND title_id = ?").run(list, title);
      this.recordListReconciliation(mapListItemRow(row), false, new Date().toISOString());
    })(listId, titleId);
  }

  /** The stored item for a title in a list, or undefined. */
  getItemByTitle(listId: string, titleId: string): ListItem | undefined {
    const row = this.db
      .query<ListItemRow, [string, string]>(
        "SELECT * FROM list_items WHERE list_id = ? AND title_id = ?",
      )
      .get(listId, titleId);
    return row ? mapListItemRow(row) : undefined;
  }

  isInList(listId: string, titleId: string): boolean {
    const row = this.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM list_items WHERE list_id = ? AND title_id = ? LIMIT 1",
      )
      .get(listId, titleId);
    return row !== null;
  }

  getListsForTitle(titleId: string): KunaiList[] {
    return this.db
      .query<ListRow, [string]>(
        `SELECT l.* FROM lists l
         INNER JOIN list_items li ON li.list_id = l.id
         WHERE li.title_id = ?
         ORDER BY l.sort_order ASC`,
      )
      .all(titleId)
      .map(mapListRow);
  }

  toggleItem(listId: string, input: ListItemInput): "added" | "removed" {
    if (this.isInList(listId, input.titleId)) {
      this.removeItemByTitle(listId, input.titleId);
      return "removed";
    }
    this.addItem({ ...input, listId });
    return "added";
  }

  private recordListReconciliation(item: ListItem, present: boolean, now: string): void {
    if (item.listId !== "watchlist" && item.listId !== "favorites") return;
    this.syncReconciliation.record(
      {
        kind: "list",
        list: item.listId,
        present,
        item: {
          titleId: item.titleId,
          mediaKind: item.mediaKind as MediaKind,
          title: item.title,
          ...(item.season === undefined ? {} : { season: item.season }),
          ...(item.episode === undefined ? {} : { episode: item.episode }),
          ...(item.externalIds ? { externalIds: item.externalIds } : {}),
        },
      },
      new Date(now),
    );
  }
}

/**
 * The list item title to persist: the incoming one, unless it is a stand-in for
 * the id and the row already holds a real name. Mirrors the history rule.
 */
function resolvePersistedListTitle(input: ListItemInput, existing: ListItem | undefined): string {
  if (!existing?.title) return input.title;
  if (!isPlaceholderTitleName(input.title, input.titleId)) return input.title;
  return isPlaceholderTitleName(existing.title, existing.titleId) ? input.title : existing.title;
}

function serializeExternalIds(externalIds: ProviderExternalIds | undefined): string | null {
  return externalIds && Object.keys(externalIds).length > 0 ? JSON.stringify(externalIds) : null;
}

function parseExternalIds(value: string | null): ProviderExternalIds | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ProviderExternalIds;
  } catch {
    return undefined;
  }
}
