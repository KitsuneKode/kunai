import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { AniListAdapter } from "@/services/sync/AniListAdapter";

/**
 * Capabilities are read, not restated. Settings decides what to offer and the
 * drain decides what to deliver from these declarations, so an overclaim here
 * becomes a control the user can operate that does nothing.
 */
describe("AniListAdapter capabilities", () => {
  const adapter = new AniListAdapter({ load: async () => ({}) } as unknown as SyncTokenStore);

  test("claims progress, watchlist and favourite membership only", () => {
    expect(adapter.capabilities).toEqual({
      episodeProgress: true,
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

describe("AniListAdapter startup", () => {
  test("loads the saved session without fetching identity until explicitly requested", async () => {
    const tokenStore = {
      load: async () => ({
        anilist: { accessToken: "saved-token", userId: 42 },
      }),
    } as unknown as SyncTokenStore;
    let fetchCalls = 0;
    const adapter = new AniListAdapter(tokenStore, async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ data: { Viewer: { id: 42, name: "kitsune" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await adapter.init();

    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getConnectedUsername()).toBeUndefined();
    expect(fetchCalls).toBe(0);

    await adapter.ensureConnectedUsername();

    expect(fetchCalls).toBe(1);
    expect(adapter.getConnectedUsername()).toBe("kitsune");
  });
});
