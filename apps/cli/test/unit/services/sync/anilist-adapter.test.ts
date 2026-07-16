import { describe, expect, test } from "bun:test";

import type { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { AniListAdapter } from "@/services/sync/AniListAdapter";

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
