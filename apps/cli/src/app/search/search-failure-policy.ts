import type { KitsuneError } from "@/domain/errors";
import type { SearchStatus } from "@/domain/session/SessionState";
import type { NetworkSnapshot } from "@/services/network/NetworkStatus";

export type BootstrapSearchState = {
  readonly searchQuery: string;
  readonly searchResults: readonly unknown[];
  readonly searchState: SearchStatus;
};

/** A failed bootstrap stays interactive until the user explicitly retries. */
export function shouldRunBootstrapSearch(state: BootstrapSearchState): boolean {
  return (
    state.searchState !== "error" &&
    state.searchQuery.trim().length > 0 &&
    state.searchResults.length === 0
  );
}

export function buildSearchFailureNote(error: KitsuneError, snapshot: NetworkSnapshot): string {
  if (snapshot.status === "offline") {
    return `Search failed: ${error.message} · retry or open /offline`;
  }
  if (error.retryable) {
    return `Search failed: ${error.message} · retry`;
  }
  return `Search failed: ${error.message} · open /diagnostics`;
}
