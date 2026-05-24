import { describe, expect, test } from "bun:test";

import { planOfflineRunway } from "@/services/offline/offline-runway-policy";

describe("offline runway policy", () => {
  test("queues only missing released episodes within target and capacity", () => {
    const plan = planOfflineRunway({
      policy: { enrolled: true, target: 3 },
      watchedCursor: { season: 1, episode: 4 },
      existingEpisodes: [{ season: 1, episode: 5, state: "ready" }],
      availableReleasedEpisodes: [
        { season: 1, episode: 5 },
        { season: 1, episode: 6 },
        { season: 1, episode: 7 },
      ],
      storage: { allowedNewAssets: 1 },
    });

    expect(plan.enqueue).toEqual([{ season: 1, episode: 6 }]);
    expect(plan.deficit).toBe(2);
  });

  test("never creates automatic work without title enrollment", () => {
    const plan = planOfflineRunway({
      policy: { enrolled: false, target: 3 },
      watchedCursor: { season: 1, episode: 4 },
      existingEpisodes: [],
      availableReleasedEpisodes: [{ season: 1, episode: 5 }],
      storage: { allowedNewAssets: 3 },
    });

    expect(plan.enqueue).toEqual([]);
    expect(plan.skipReason).toBe("not-enrolled");
  });

  test("counts queued and repairable local continuation toward a bounded runway", () => {
    const plan = planOfflineRunway({
      policy: { enrolled: true, target: 2 },
      watchedCursor: { season: 1, episode: 4 },
      existingEpisodes: [
        { season: 1, episode: 5, state: "queued" },
        { season: 1, episode: 6, state: "repairable" },
      ],
      availableReleasedEpisodes: [{ season: 1, episode: 7 }],
      storage: { allowedNewAssets: 4 },
    });

    expect(plan.enqueue).toEqual([]);
    expect(plan.skipReason).toBe("already-healthy");
  });

  test("does not overfill when storage admission permits no new assets", () => {
    const plan = planOfflineRunway({
      policy: { enrolled: true, target: 2 },
      watchedCursor: { season: 1, episode: 4 },
      existingEpisodes: [],
      availableReleasedEpisodes: [{ season: 1, episode: 5 }],
      storage: { allowedNewAssets: 0 },
    });

    expect(plan.enqueue).toEqual([]);
    expect(plan.skipReason).toBe("capacity-blocked");
  });
});
