import { describe, expect, test } from "bun:test";

import { createMemoryAnalyticsStore } from "../src/memory-store";
import { loadAnalyticsRuntimeConfig } from "../src/runtime-config";

/** Avoid opening a real Neon connection while asserting configuration logic. */
const stubStore = () => createMemoryAnalyticsStore();

describe("runtime config fail-closed", () => {
  test("returns null when the database URL or hash secret is missing", () => {
    expect(loadAnalyticsRuntimeConfig({}, stubStore)).toBeNull();
    expect(
      loadAnalyticsRuntimeConfig({ DATABASE_URL: "postgres://example" }, stubStore),
    ).toBeNull();
    expect(loadAnalyticsRuntimeConfig({ ANALYTICS_HASH_SECRET: "secret" }, stubStore)).toBeNull();
  });

  test("blank-but-present values are still missing", () => {
    expect(
      loadAnalyticsRuntimeConfig(
        { DATABASE_URL: "   ", ANALYTICS_HASH_SECRET: "secret" },
        stubStore,
      ),
    ).toBeNull();
  });

  test("loads when required secrets are present", () => {
    const cfg = loadAnalyticsRuntimeConfig(
      {
        DATABASE_URL: "postgres://example",
        ANALYTICS_HASH_SECRET: "secret",
        CRON_SECRET: "cron",
        ANALYTICS_ADMIN_TOKEN: "admin",
      },
      stubStore,
    );
    expect(cfg).not.toBeNull();
    expect(cfg?.hashSecret).toBe("secret");
    expect(cfg?.cronSecret).toBe("cron");
    expect(cfg?.adminToken).toBe("admin");
  });

  test("cron and admin secrets are optional at load time", () => {
    const cfg = loadAnalyticsRuntimeConfig(
      { DATABASE_URL: "postgres://example", ANALYTICS_HASH_SECRET: "secret" },
      stubStore,
    );
    expect(cfg?.cronSecret).toBe("");
    expect(cfg?.adminToken).toBe("");
  });
});
