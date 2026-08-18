import { describe, expect, test } from "bun:test";

import { canSend, type ConsentEnv, resolveConsentState } from "@/domain/analytics/consent-policy";
import {
  DEFAULT_ANALYTICS_ENDPOINT,
  resolveAnalyticsEndpoint,
  UNSET_INSTALL_ID_PLACEHOLDER,
  UsageAnalyticsService,
  type AnalyticsFetch,
} from "@/services/analytics/usage-analytics-service";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

const UUID = "11111111-2222-4333-8444-555555555555";
const TEST_ENDPOINT = "https://analytics.example.test/api/ping";

function makeConfig(overrides: Partial<KitsuneConfig> = {}) {
  let raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...overrides };
  let saves = 0;
  return {
    getRaw: () => ({ ...raw }),
    async update(partial: Partial<KitsuneConfig>) {
      raw = { ...raw, ...partial };
    },
    async save() {
      saves += 1;
    },
    get rawRef() {
      return raw;
    },
    get saveCount() {
      return saves;
    },
  };
}

function makeService(
  config: ReturnType<typeof makeConfig>,
  options: { fetchImpl?: AnalyticsFetch; env?: { DO_NOT_TRACK?: string; CI?: string } } = {},
) {
  return new UsageAnalyticsService({
    config,
    currentVersion: "0.3.0",
    endpoint: TEST_ENDPOINT,
    fetchImpl:
      options.fetchImpl ??
      (async () => {
        throw new Error("fetch must not be called");
      }),
    now: () => Date.UTC(2026, 7, 14),
    platform: { os: "linux", arch: "x64" },
    env: options.env ?? {},
  });
}

describe("identifier lifecycle", () => {
  test("declining stores no install id", async () => {
    const config = makeConfig({ analytics: "unset", installId: UUID });
    await makeService(config).setConsent("disabled");
    expect(config.rawRef.analytics).toBe("disabled");
    expect(config.rawRef.installId).toBe("");
  });

  test("enabling mints one install id", async () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    await makeService(config).setConsent("enabled");
    expect(config.rawRef.analytics).toBe("enabled");
    expect(config.rawRef.installId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("describePayload writes nothing and hides the id when not enabled", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const payload = makeService(config).describePayload();
    expect(payload.installId).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
    expect(config.rawRef.installId).toBe("");
    expect(config.saveCount).toBe(0);
  });

  test("describePayload shows the real id once enabled", () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    expect(makeService(config).describePayload().installId).toBe(UUID);
  });

  test("rendering the menu twice creates no install id", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const service = makeService(config);
    service.describePayload();
    service.describePayload();
    expect(config.rawRef.installId).toBe("");
    expect(config.saveCount).toBe(0);
  });
});

describe("consentPatch", () => {
  test("is pure and returns the same keys setConsent would write", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const patch = makeService(config).consentPatch("disabled");
    expect(patch).toEqual({ analytics: "disabled", installId: "" });
    expect(config.saveCount).toBe(0);
  });

  test("refuses to enable under DO_NOT_TRACK", () => {
    const config = makeConfig({ analytics: "unset" });
    const patch = makeService(config, { env: { DO_NOT_TRACK: "1" } }).consentPatch("enabled");
    expect(patch).toEqual({ analytics: "disabled", installId: "" });
  });
});

describe("onSessionStart", () => {
  test("an unconsented interactive run requests the notice without persisting or sending", async () => {
    const config = makeConfig({ analytics: "unset" });
    const calls: string[] = [];
    const service = makeService(config, {
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });

    const outcome = await service.onSessionStart({ isInteractive: true });

    expect(outcome).toEqual({ kind: "needs-disclosure" });
    expect(calls).toEqual([]);
    expect(config.rawRef.analytics).toBe("unset");
    expect(config.rawRef.installId).toBe("");
    expect(config.saveCount).toBe(0);
  });

  test("the launch after disclosure does send", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const calls: string[] = [];
    const service = makeService(config, {
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });

    const outcome = await service.onSessionStart({ isInteractive: true });

    expect(outcome).toEqual({ kind: "pinged" });
    expect(calls).toEqual([TEST_ENDPOINT]);
  });

  test("no TTY stays unset — writes nothing, sends nothing", async () => {
    const config = makeConfig({ analytics: "unset" });
    const outcome = await makeService(config).onSessionStart({ isInteractive: false });
    expect(outcome).toEqual({ kind: "quiet" });
    expect(config.rawRef.analytics).toBe("unset");
    expect(config.saveCount).toBe(0);
  });

  test("no TTY prevents a send even after the user previously opted in", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const calls: string[] = [];
    const service = makeService(config, {
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });

    expect(await service.onSessionStart({ isInteractive: false })).toEqual({ kind: "quiet" });
    expect(calls).toEqual([]);
  });

  test("recording the upgrader notice leaves analytics unset and prevents another prompt", async () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const service = makeService(config);

    await service.markNoticeShown();

    expect(config.rawRef).toMatchObject({
      analytics: "unset",
      installId: "",
      analyticsNoticeShown: true,
    });
    expect(await service.onSessionStart({ isInteractive: true })).toEqual({ kind: "quiet" });
  });

  test("env block rewrites a stale enabled config to disabled and clears the id", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const outcome = await makeService(config, { env: { CI: "true" } }).onSessionStart({
      isInteractive: true,
    });
    expect(outcome).toEqual({ kind: "quiet" });
    expect(config.rawRef.analytics).toBe("disabled");
    expect(config.rawRef.installId).toBe("");
  });

  test("CI=0 does not block — the regression this replaces", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const calls: string[] = [];
    const service = makeService(config, {
      env: { CI: "0", DO_NOT_TRACK: "0" },
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });
    await service.onSessionStart({ isInteractive: true });
    expect(config.rawRef.analytics).toBe("enabled");
    expect(calls).toHaveLength(1);
  });
});

describe("endpoint configuration", () => {
  test("ships a default endpoint on a domain Kunai controls", () => {
    // Baked into immutable npm tarballs and compiled binaries, so it has to
    // outlive whatever host serves it today — DNS can move, a hosting
    // provider's own URL in a shipped binary cannot.
    expect(DEFAULT_ANALYTICS_ENDPOINT).toBe("https://analytics.kunai.kitsunekode.in/api/ping");
    expect(new URL(DEFAULT_ANALYTICS_ENDPOINT).protocol).toBe("https:");
    expect(DEFAULT_ANALYTICS_ENDPOINT).not.toMatch(/vercel\.app|netlify\.app|herokuapp\.com/);
    expect(resolveAnalyticsEndpoint({})).toBe(DEFAULT_ANALYTICS_ENDPOINT);
  });

  test("a self-hoster can still point installs at their own ingest", () => {
    expect(resolveAnalyticsEndpoint({ KUNAI_ANALYTICS_URL: "https://mine.test/ping" })).toBe(
      "https://mine.test/ping",
    );
    expect(resolveAnalyticsEndpoint({}, "https://config.test/ping")).toBe(
      "https://config.test/ping",
    );
  });

  test("a default endpoint is not consent: the gates are unchanged by it", () => {
    // The endpoint says where a ping would go, never whether one may be sent.
    const gate = (stored: "unset" | "enabled", env: ConsentEnv, isInteractive = true) =>
      canSend(resolveConsentState({ env, isInteractive, stored }));

    expect(gate("unset", {})).toBe(false);
    expect(gate("enabled", { DO_NOT_TRACK: "1" })).toBe(false);
    expect(gate("enabled", { CI: "true" })).toBe(false);
    expect(gate("enabled", {}, false)).toBe(false);
    expect(gate("enabled", {})).toBe(true);
  });
});
