import { describe, expect, test } from "bun:test";

import { loadTelemetryRuntimeConfig } from "../src/runtime-config";

describe("runtime config fail-closed", () => {
  test("returns null when Redis or hash secret is missing", () => {
    expect(loadTelemetryRuntimeConfig({})).toBeNull();
    expect(
      loadTelemetryRuntimeConfig({
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token",
      }),
    ).toBeNull();
    expect(
      loadTelemetryRuntimeConfig({
        TELEMETRY_HASH_SECRET: "secret",
      }),
    ).toBeNull();
  });

  test("loads when required secrets are present", () => {
    const cfg = loadTelemetryRuntimeConfig({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
      TELEMETRY_HASH_SECRET: "secret",
      CRON_SECRET: "cron",
    });
    expect(cfg).not.toBeNull();
    expect(cfg?.hashSecret).toBe("secret");
    expect(cfg?.cronSecret).toBe("cron");
  });
});
