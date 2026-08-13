import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { TmdbAdapter } from "@/services/sync/TmdbAdapter";

const tokenStore = { load: async () => ({}) } as unknown as SyncTokenStore;

/**
 * Capabilities are read, not restated. Settings decides what to offer and the
 * drain decides what to deliver from these declarations, so an overclaim here
 * becomes a control the user can operate that does nothing.
 */
describe("TmdbAdapter capabilities", () => {
  const adapter = new TmdbAdapter(tokenStore, "test-key");

  /**
   * TMDB v3 has no episode-progress endpoint. The shipped `pushWatched()`
   * pretended otherwise by POSTing `watchlist: false` — which does not record
   * progress, it removes the title from the watchlist.
   */
  test("does not claim episode progress", () => {
    expect(adapter.capabilities.episodeProgress).toBe(false);
  });

  test("claims exactly watchlist and favourite membership", () => {
    expect(adapter.capabilities).toEqual({
      episodeProgress: false,
      watchlistMembership: true,
      favoriteMembership: true,
      pullLists: false,
      rating: false,
    });
  });

  /** Nothing on this branch reads remote lists or writes ratings. */
  test("claims neither pull nor rating", () => {
    expect(adapter.capabilities.pullLists).toBe(false);
    expect(adapter.capabilities.rating).toBe(false);
  });
});
