import { describe, expect, test } from "bun:test";
import { hostname, userInfo } from "node:os";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import {
  resolveTelemetryConsent,
  type TelemetryConsentDecision,
} from "@/services/telemetry/consent";
import {
  ensureInstallId,
  isMacShaped,
  looksLikeHostnameOrUsername,
} from "@/services/telemetry/install-id";
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  TelemetryService,
  type TelemetryFetch,
  type TelemetryPayload,
} from "@/services/telemetry/TelemetryService";

function makeConfig(overrides: Partial<KitsuneConfig> = {}) {
  let raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...overrides };
  return {
    getRaw: () => ({ ...raw }),
    async update(partial: Partial<KitsuneConfig>) {
      raw = { ...raw, ...partial };
    },
    async save() {},
    get rawRef() {
      return raw;
    },
  };
}

describe("TelemetryService privacy gate", () => {
  test("telemetry unset performs zero network calls", async () => {
    const config = makeConfig({ telemetry: "unset" });
    const fetchCalls: unknown[] = [];
    const fetchImpl: TelemetryFetch = async (...args) => {
      fetchCalls.push(args);
      throw new Error("fetch must not be called when telemetry is unset");
    };

    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl,
      now: () => Date.UTC(2026, 6, 20),
    });

    await service.maybePing();
    service.pingInBackground();
    await Bun.sleep(10);

    expect(fetchCalls).toEqual([]);
  });

  test("disabled and empty-endpoint states never fetch", async () => {
    const fetchImpl: TelemetryFetch = async () => {
      throw new Error("fetch must not be called when telemetry is disabled");
    };
    const disabled = new TelemetryService({
      config: makeConfig({
        telemetry: "disabled",
        installId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl,
    });
    await disabled.maybePing();

    const enabledButEmptyEndpoint = new TelemetryService({
      config: makeConfig({
        telemetry: "enabled",
        installId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
      currentVersion: "0.3.0",
      endpoint: "",
      fetchImpl,
    });
    await enabledButEmptyEndpoint.maybePing();
  });
});

describe("install id", () => {
  test("is a random UUID and does not match hostname, username, or MAC-shaped values", () => {
    const id = ensureInstallId({ installId: "" }, () => crypto.randomUUID());
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(looksLikeHostnameOrUsername(id)).toBe(false);
    expect(isMacShaped(id)).toBe(false);
    expect(id.toLowerCase()).not.toBe(hostname().toLowerCase());
    expect(id.toLowerCase()).not.toBe(userInfo().username.toLowerCase());
    expect(isMacShaped("aa:bb:cc:dd:ee:ff")).toBe(true);
    expect(looksLikeHostnameOrUsername(hostname())).toBe(true);
  });
});

describe("telemetry payload contract", () => {
  test("payload is exactly { installId, version, os, arch, ts }", async () => {
    const installId = "11111111-2222-4333-8444-555555555555";
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);
    let captured: TelemetryPayload | undefined;
    const fetchImpl: TelemetryFetch = async (_input, init) => {
      captured = JSON.parse(String(init?.body)) as TelemetryPayload;
      return new Response("{}", { status: 204 });
    };

    const config = makeConfig({
      telemetry: "enabled",
      installId,
      lastTelemetryPingAt: 0,
    });
    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: "https://example.test/api/ping",
      fetchImpl,
      now: () => now,
      platform: { os: "linux", arch: "x64" },
    });

    await service.maybePing();

    expect(captured).toEqual({
      installId,
      version: "0.3.0",
      os: "linux",
      arch: "x64",
      ts: now,
    });
    expect(Object.keys(captured ?? {}).sort()).toEqual([
      "arch",
      "installId",
      "os",
      "ts",
      "version",
    ]);
  });

  test("previewPayload matches the wire contract without fetching", () => {
    const fetchImpl: TelemetryFetch = async () => {
      throw new Error("previewPayload must not fetch");
    };
    const service = new TelemetryService({
      config: makeConfig({
        telemetry: "enabled",
        installId: "11111111-2222-4333-8444-555555555555",
      }),
      currentVersion: "0.3.0",
      endpoint: "https://example.test/api/ping",
      fetchImpl,
      now: () => 1_700_000_000_000,
      platform: { os: "linux", arch: "arm64" },
    });

    expect(service.previewPayload()).toEqual({
      installId: "11111111-2222-4333-8444-555555555555",
      version: "0.3.0",
      os: "linux",
      arch: "arm64",
      ts: 1_700_000_000_000,
    });
  });
});

describe("telemetry cadence", () => {
  test("sends at most one ping per 24h and records lastTelemetryPingAt", async () => {
    const calls: number[] = [];
    const fetchImpl: TelemetryFetch = async () => {
      calls.push(1);
      return new Response("{}", { status: 204 });
    };
    const config = makeConfig({
      telemetry: "enabled",
      installId: "11111111-2222-4333-8444-555555555555",
      lastTelemetryPingAt: 0,
    });
    const t0 = Date.UTC(2026, 6, 20);
    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: "https://example.test/api/ping",
      fetchImpl,
      now: () => t0,
      platform: { os: "linux", arch: "x64" },
    });

    await service.maybePing();
    await service.maybePing();
    expect(calls).toHaveLength(1);
    expect(config.rawRef.lastTelemetryPingAt).toBe(t0);

    const laterSameDay = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: "https://example.test/api/ping",
      fetchImpl,
      now: () => t0 + 12 * 60 * 60 * 1000,
      platform: { os: "linux", arch: "x64" },
    });
    await laterSameDay.maybePing();
    expect(calls).toHaveLength(1);

    const nextDay = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: "https://example.test/api/ping",
      fetchImpl,
      now: () => t0 + 24 * 60 * 60 * 1000,
      platform: { os: "linux", arch: "x64" },
    });
    await nextDay.maybePing();
    expect(calls).toHaveLength(2);
  });

  test("failures are silent and do not throw", async () => {
    const service = new TelemetryService({
      config: makeConfig({
        telemetry: "enabled",
        installId: "11111111-2222-4333-8444-555555555555",
        lastTelemetryPingAt: 0,
      }),
      currentVersion: "0.3.0",
      endpoint: "https://example.test/api/ping",
      fetchImpl: async () => {
        throw new Error("network down");
      },
      now: () => Date.UTC(2026, 6, 20),
      platform: { os: "linux", arch: "x64" },
    });
    await expect(service.maybePing()).resolves.toBeUndefined();
  });
});

describe("telemetry consent", () => {
  test("DO_NOT_TRACK, CI, non-TTY, decline, and timeout resolve to disabled", () => {
    const cases: Array<{
      input: Parameters<typeof resolveTelemetryConsent>[0];
      expected: TelemetryConsentDecision;
    }> = [
      {
        input: { env: { DO_NOT_TRACK: "1" }, isTty: true, choice: "enabled" },
        expected: "disabled",
      },
      {
        input: { env: { CI: "true" }, isTty: true, choice: "enabled" },
        expected: "disabled",
      },
      {
        input: { env: {}, isTty: false, choice: "enabled" },
        expected: "disabled",
      },
      {
        input: { env: {}, isTty: true, choice: "disabled" },
        expected: "disabled",
      },
      {
        input: { env: {}, isTty: true, choice: "timeout" },
        expected: "disabled",
      },
      {
        input: { env: {}, isTty: true, choice: "enabled" },
        expected: "enabled",
      },
    ];

    for (const { input, expected } of cases) {
      expect(resolveTelemetryConsent(input)).toBe(expected);
    }
  });
});
