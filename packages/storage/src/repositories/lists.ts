import { randomUUID } from "node:crypto";

import type { KunaiDatabase } from "../sqlite";

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
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly notes?: string;
  readonly addedAt: string;
  readonly sortOrder: number;
}

export interface ListItemInput {
  readonly listId: string;
  readonly titleId: string;
  readonly mediaKind: string;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly notes?: string;
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
  readonly title: string;
  readonly season: number | null;
  readonly episode: number | null;
  readonly notes: string | null;
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
    title: row.title,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    notes: row.notes ?? undefined,
    addedAt: row.added_at,
    sortOrder: row.sort_order,
  };
}

export class ListRepository {
  constructor(private readonly db: KunaiDatabase) {}

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
    const id = randomUUID();
    const now = new Date().toISOString();
    const maxOrder = this.db
      .query<{ max_order: number | null }, []>("SELECT MAX(sort_order) AS max_order FROM lists")
      .get()!;
    const sortOrder = (maxOrder.max_order ?? -1) + 1;

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

    return this.getList(id)!;
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

  addItem(input: ListItemInput): ListItem {
    const id = randomUUID();
    const now = new Date().toISOString();
    const maxOrder = this.db
      .query<{ max_order: number | null }, [string]>(
        "SELECT MAX(sort_order) AS max_order FROM list_items WHERE list_id = ?",
      )
      .get(input.listId)!;
    const sortOrder = (maxOrder.max_order ?? -1) + 1;

    this.db
      .query(
        `INSERT INTO list_items (id, list_id, title_id, media_kind, title, season, episode, notes, added_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.listId,
        input.titleId,
        input.mediaKind,
        input.title,
        input.season ?? null,
        input.episode ?? null,
        input.notes ?? null,
        now,
        sortOrder,
      );

    const row = this.db
      .query<ListItemRow, [string]>("SELECT * FROM list_items WHERE id = ?")
      .get(id)!;
    return mapListItemRow(row);
  }

  removeItem(id: string): void {
    this.db.query("DELETE FROM list_items WHERE id = ?").run(id);
  }

  removeItemByTitle(listId: string, titleId: string): void {
    this.db.query("DELETE FROM list_items WHERE list_id = ? AND title_id = ?").run(listId, titleId);
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
}
