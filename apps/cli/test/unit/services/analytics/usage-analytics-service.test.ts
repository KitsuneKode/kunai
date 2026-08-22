import { describe, expect, test } from "bun:test";

import { canSend, type ConsentEnv, resolveConsentState } from "@/domain/analytics/consent-policy";
import {
  installIdDigest,
  isValidInstallId,
  rotateInstallId,
} from "@/services/analytics/install-id";
import {
  ANALYTICS_PAYLOAD_KEYS,
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

  test("describePayload shows a real identifier once enabled", () => {
    // Was the stored UUID; it is the digest now, because that is what is sent.
    // See "the preview shows what is actually sent" below.
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    expect(makeService(config).describePayload().installId).toBe(installIdDigest(UUID));
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

/**
 * The raw install id is the only per-user state analytics holds, so the
 * property worth pinning is a negative one: whatever else the body contains,
 * the stored id must not appear anywhere in it.
 */
describe("the wire carries a digest, never the stored id", () => {
  test("the body sends sha256(installId) and the id stays on disk", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let body = "";
    const service = makeService(config, {
      fetchImpl: async (_input, init) => {
        body = String((init as RequestInit | undefined)?.body ?? "");
        return new Response(null, { status: 204 });
      },
    });

    await service.onSessionStart({ isInteractive: true });

    const sent = JSON.parse(body) as { installId: string };
    expect(sent.installId).toBe(installIdDigest(UUID));
    expect(sent.installId).toMatch(/^[0-9a-f]{64}$/);
    // The negative that matters.
    expect(body).not.toContain(UUID);
    // The identity still persists locally, or every ping looks like a new install.
    expect(config.rawRef.installId).toBe(UUID);
  });

  test("the digest is stable, so daily-active counts installs and not pings", () => {
    expect(installIdDigest(UUID)).toBe(installIdDigest(UUID));
    expect(installIdDigest(UUID)).not.toBe(installIdDigest(crypto.randomUUID()));
  });

  test("rotating yields an identity unlinkable to the one it replaced", () => {
    const next = rotateInstallId();
    expect(next).not.toBe(UUID);
    expect(isValidInstallId(next)).toBe(true);
    expect(installIdDigest(next)).not.toBe(installIdDigest(UUID));
  });

  test("the preview shows what is actually sent, not the stored id", async () => {
    // `/analytics show` renders this under "Exact JSON that would be sent", and
    // the setup screen shows the same shape. Once the wire carried a digest,
    // previewing the raw UUID made that disclosure false on the one surface
    // whose entire job is telling the user what leaves their machine.
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const preview = makeService(config).describePayload();

    expect(preview.installId).toBe(installIdDigest(UUID));
    expect(preview.installId).not.toBe(UUID);

    // And it must match the real body byte for byte.
    let body = "";
    const service = makeService(config, {
      fetchImpl: async (_input, init) => {
        body = String((init as RequestInit | undefined)?.body ?? "");
        return new Response(null, { status: 204 });
      },
    });
    await service.onSessionStart({ isInteractive: true });
    expect((JSON.parse(body) as { installId: string }).installId).toBe(preview.installId);
  });

  test("previewing still mints nothing for someone who has not opted in", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    expect(makeService(config).describePayload().installId).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
    expect(config.rawRef.installId).toBe("");
  });

  test("the payload is still exactly the five documented keys", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let body = "";
    const service = makeService(config, {
      fetchImpl: async (_input, init) => {
        body = String((init as RequestInit | undefined)?.body ?? "");
        return new Response(null, { status: 204 });
      },
    });
    await service.onSessionStart({ isInteractive: true });
    expect(Object.keys(JSON.parse(body) as object).sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
  });
});
