import type { KunaiList, ListItem, ListItemInput, ListKind, ListRepository } from "@kunai/storage";

export type { KunaiList, ListItem, ListItemInput, ListKind };

export class ListService {
  constructor(private readonly repo: ListRepository) {}

  getLists(): KunaiList[] {
    return this.repo.getLists();
  }

  getWatchlist(): ListItem[] {
    return this.repo.getItems("watchlist");
  }

  getFavorites(): ListItem[] {
    return this.repo.getItems("favorites");
  }

  getListItems(listId: string): ListItem[] {
    return this.repo.getItems(listId);
  }

  isInWatchlist(titleId: string): boolean {
    return this.repo.isInList("watchlist", titleId);
  }

  isInFavorites(titleId: string): boolean {
    return this.repo.isInList("favorites", titleId);
  }

  isInList(listId: string, titleId: string): boolean {
    return this.repo.isInList(listId, titleId);
  }

  getListsForTitle(titleId: string): KunaiList[] {
    return this.repo.getListsForTitle(titleId);
  }

  addToWatchlist(input: Omit<ListItemInput, "listId">): ListItem {
    return this.repo.addItem({ ...input, listId: "watchlist" });
  }

  removeFromWatchlist(titleId: string): void {
    this.repo.removeItemByTitle("watchlist", titleId);
  }

  toggleWatchlist(input: Omit<ListItemInput, "listId">): "added" | "removed" {
    return this.repo.toggleItem("watchlist", { ...input, listId: "watchlist" });
  }

  addToFavorites(input: Omit<ListItemInput, "listId">): ListItem {
    return this.repo.addItem({ ...input, listId: "favorites" });
  }

  removeFromFavorites(titleId: string): void {
    this.repo.removeItemByTitle("favorites", titleId);
  }

  createList(name: string, kind: ListKind = "custom"): KunaiList {
    return this.repo.createList({ name, kind });
  }

  deleteList(id: string): void {
    this.repo.deleteList(id);
  }

  addToList(listId: string, input: Omit<ListItemInput, "listId">): ListItem {
    return this.repo.addItem({ ...input, listId });
  }

  removeFromList(listId: string, titleId: string): void {
    this.repo.removeItemByTitle(listId, titleId);
  }
}
