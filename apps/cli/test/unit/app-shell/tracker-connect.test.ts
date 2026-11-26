import { describe, expect, test } from "bun:test";

import { connectNamedTracker, disconnectNamedTracker } from "@/app-shell/workflows/tracker-connect";
import type { Container } from "@/container";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigService";

function fakeContainer(
  connect: (signal: AbortSignal) => Promise<{ ok: true } | { ok: false; error: string }>,
) {
  const notes: string[] = [];
  const container = {
    stateManager: {
      dispatch: (action: { type: string; note?: string }) => {
        if (action.note) notes.push(action.note);
      },
    },
    syncService: {
      adapters: [
        {
          id: "anilist",
          displayName: "AniList",
          getConnection: () => ({ state: "disconnected" }),
          connect: ({ signal }: { signal: AbortSignal }) => connect(signal),
        },
      ],
      resumeAfterReauth: () => 0,
      deliverSoon: () => undefined,
    },
  } as unknown as Container;
  return { container, notes };
}

describe("connectNamedTracker", () => {
  test("threads the caller's abort signal and reports cancellation distinctly", async () => {
    let observedSignal: AbortSignal | null = null;
    const { container, notes } = fakeContainer(async (signal) => {
      observedSignal = signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      return { ok: false, error: "cancelled" };
    });
    const controller = new AbortController();

    const pending = connectNamedTracker(container, "anilist", { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(observedSignal === controller.signal).toBe(true);
    expect(notes.at(-1)).toContain("cancelled");
  });

  test("reports a failed handoff without claiming the tracker is connected", async () => {
    const { container, notes } = fakeContainer(async () => ({
      ok: false,
      error: "approval expired",
    }));

    await expect(
      connectNamedTracker(container, "anilist", { signal: new AbortController().signal }),
    ).resolves.toEqual({ status: "failed", error: "approval expired" });
    expect(notes.at(-1)).toContain("approval expired");
  });
});

const ANILIST_CAPABILITIES = {
  episodeProgress: true,
  watchlistMembership: true,
  favoriteMembership: true,
  pullLists: false,
  rating: false,
};

function linkableContainer(state: "connected" | "disconnected") {
  let config = structuredClone(DEFAULT_CONFIG);
  const saves: number[] = [];
  const adapter = {
    id: "anilist" as const,
    displayName: "AniList",
    capabilities: ANILIST_CAPABILITIES,
    getConnection: () => ({ state }),
    connect: async () => ({ ok: true as const }),
    disconnect: async () => undefined,
  };
  // SAFETY: partial container; the link flow reads only these members.
  const container: Container = {
    stateManager: { dispatch: () => undefined },
    config: {
      getRaw: () => config,
      update: async (patch: Partial<typeof config>) => {
        config = { ...config, ...patch };
      },
      save: async () => {
        saves.push(1);
      },
    },
    syncService: { adapters: [adapter], resumeAfterReauth: () => 0, deliverSoon: () => undefined },
  } as never;
  return { container, adapter, config: () => config, saves };
}

describe("linking turns sync on; unlinking turns it off", () => {
  test("a fresh link turns on sync, progress and lists, and saves", async () => {
    const { container, config, saves } = linkableContainer("disconnected");
    await connectNamedTracker(container, "anilist", { signal: new AbortController().signal });
    expect(config().sync.anilist).toEqual({ enabled: true, trackWatched: true, syncList: true });
    expect(config().sync.tmdb).toEqual(DEFAULT_CONFIG.sync.tmdb);
    expect(saves.length).toBe(1);
  });

  test("an account that was already linked keeps the user's own switches", async () => {
    const { container, config } = linkableContainer("connected");
    await connectNamedTracker(container, "anilist", { signal: new AbortController().signal });
    expect(config().sync.anilist).toEqual(DEFAULT_CONFIG.sync.anilist);
  });

  test("unlinking turns the main switch off and keeps the rest for a later reconnect", async () => {
    const { container, adapter, config } = linkableContainer("disconnected");
    await connectNamedTracker(container, "anilist", { signal: new AbortController().signal });
    await disconnectNamedTracker(container, adapter);
    expect(config().sync.anilist).toEqual({ enabled: false, trackWatched: true, syncList: true });
  });
});
