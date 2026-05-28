import { describe, expect, test } from "bun:test";

import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { DEFAULT_TUNING, resolveTuning, tuningEnvKey } from "@/services/persistence/tuning";

describe("resolveTuning", () => {
  test("returns defaults when no overrides given", () => {
    expect(resolveTuning(undefined, {})).toEqual(DEFAULT_TUNING);
  });

  test("config-file override wins over default", () => {
    const result = resolveTuning({ episodePrefetchWaitBudgetMs: 5000 }, {});
    expect(result.episodePrefetchWaitBudgetMs).toBe(5000);
  });

  test("env override wins over config-file override", () => {
    const result = resolveTuning(
      { episodePrefetchWaitBudgetMs: 5000 },
      { KUNAI_TUNING_EPISODE_PREFETCH_WAIT_BUDGET_MS: "6000" },
    );
    expect(result.episodePrefetchWaitBudgetMs).toBe(6000);
  });

  test("clamps below the minimum bound", () => {
    const result = resolveTuning({ mpvReconnectBaseBackoffMs: 0 }, {});
    expect(result.mpvReconnectBaseBackoffMs).toBe(100);
  });

  test("clamps above the maximum bound", () => {
    const result = resolveTuning({ mpvReconnectMaxBackoffMs: 10_000_000 }, {});
    expect(result.mpvReconnectMaxBackoffMs).toBe(120_000);
  });

  test("ignores non-numeric / NaN env values and falls back to config/default", () => {
    const result = resolveTuning(
      { titleDetailFetchTimeoutMs: 7000 },
      { KUNAI_TUNING_TITLE_DETAIL_FETCH_TIMEOUT_MS: "not-a-number" },
    );
    expect(result.titleDetailFetchTimeoutMs).toBe(7000);
  });

  test("tuningEnvKey converts camelCase field to KUNAI_TUNING_SCREAMING_SNAKE", () => {
    expect(tuningEnvKey("mpvReconnectBaseBackoffMs")).toBe(
      "KUNAI_TUNING_MPV_RECONNECT_BASE_BACKOFF_MS",
    );
  });
});

describe("ConfigService.tuning", () => {
  test("exposes resolved defaults with no overrides", async () => {
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG }),
      save: async () => {},
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);
    expect(service.tuning).toEqual(DEFAULT_TUNING);
  });

  test("applies a config-file tuning override", async () => {
    const store = {
      load: async () => ({ ...DEFAULT_CONFIG, tuningOverrides: { thumbnailTimeoutMs: 20_000 } }),
      save: async () => {},
      reset: async () => {},
    };
    const service = await ConfigServiceImpl.load(store);
    expect(service.tuning.thumbnailTimeoutMs).toBe(20_000);
  });
});
