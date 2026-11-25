import { describe, expect, test } from "bun:test";

import { analyticsMonthKey } from "@/domain/analytics/analytics-day";
import { canSend, type ConsentEnv, resolveConsentState } from "@/domain/analytics/consent-policy";
import { isValidInstallId, monthlyWireId, rotateInstallId } from "@/services/analytics/install-id";
import type { PingLog } from "@/services/analytics/ping-log";
import {
  ANALYTICS_PAYLOAD_KEYS,
  analyticsOs,
  DEFAULT_ANALYTICS_ENDPOINT,
  isTransportSafeAnalyticsEndpoint,
  resolveAnalyticsEndpoint,
  UNSET_COHORT_PLACEHOLDER,
  UNSET_INSTALL_ID_PLACEHOLDER,
  UsageAnalyticsService,
  type AnalyticsFetch,
} from "@/services/analytics/usage-analytics-service";
import type { AnalyticsPingCompletion, KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

import { memoryPingLog } from "../../../support/analytics-fixtures";

const UUID = "11111111-2222-4333-8444-555555555555";
/** 14 Aug 2026, before the IST cutover: labels are UTC, so the day is 2026-08-14. */
const NOW = Date.UTC(2026, 7, 14);
const TEST_ENDPOINT = "https://analytics.example.test/api/ping";

function makeConfig(overrides: Partial<KitsuneConfig> = {}) {
  let raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...overrides };
  let saves = 0;
  let persisted = { ...raw };
  return {
    getRaw: () => ({ ...raw }),
    async update(partial: Partial<KitsuneConfig>) {
      raw = { ...raw, ...partial };
    },
    async save() {
      saves += 1;
      persisted = { ...raw };
    },
    async recordAnalyticsPing(completion: AnalyticsPingCompletion) {
      if (raw.analytics !== "enabled" || raw.installId !== completion.installId) return false;
      raw = {
        ...raw,
        analyticsRetryAfter: completion.analyticsRetryAfter,
      };
      if (completion.lastAnalyticsPingAt !== undefined)
        raw = { ...raw, lastAnalyticsPingAt: completion.lastAnalyticsPingAt };
      if (completion.analyticsCohort && !raw.analyticsCohort)
        raw = { ...raw, analyticsCohort: completion.analyticsCohort };
      saves += 1;
      persisted = { ...raw };
      return true;
    },
    async readPersistedAnalyticsConsent() {
      return { analytics: persisted.analytics, installId: persisted.installId };
    },
    get persisted() {
      return persisted;
    },
    get rawRef() {
      return raw;
    },
    get saveCount() {
      return saves;
    },
  };
}

/**
 * `onSessionStart` fires the ping in the background, and the send now waits on
 * the persisted-consent read first. Every fake here resolves at once, so one
 * macrotask turn lets that chain finish; assertions on what was (not) sent run
 * after it, not before.
 */
const settleBackgroundPing = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeService(
  config: Pick<
    ConfigServiceImpl,
    "getRaw" | "update" | "save" | "recordAnalyticsPing" | "readPersistedAnalyticsConsent"
  >,
  options: {
    fetchImpl?: AnalyticsFetch;
    env?: { DO_NOT_TRACK?: string; CI?: string };
    endpoint?: string;
    pingLog?: PingLog;
    now?: () => number;
  } = {},
) {
  return new UsageAnalyticsService({
    config,
    currentVersion: "0.3.0",
    endpoint: options.endpoint ?? TEST_ENDPOINT,
    pingLog: options.pingLog ?? memoryPingLog(),
    fetchImpl:
      options.fetchImpl ??
      (async () => {
        throw new Error("fetch must not be called");
      }),
    now: options.now ?? (() => NOW),
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
    expect(payload.id).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
    expect(payload.cohort).toBe(UNSET_COHORT_PLACEHOLDER);
    expect(config.rawRef.installId).toBe("");
    expect(config.saveCount).toBe(0);
  });

  test("describePayload shows a real identifier once enabled", () => {
    // Was the stored UUID; it is this month's HMAC now, because that is what
    // is sent. See "the preview shows what is actually sent" below.
    const config = makeConfig({
      analytics: "enabled",
      installId: UUID,
      analyticsCohort: "2026-07",
    });
    expect(makeService(config).describePayload()).toMatchObject({
      id: monthlyWireId(UUID, "2026-08"),
      cohort: "2026-07",
      day: "2026-08-14",
    });
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

describe("pending ping identity", () => {
  const rotatedId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const outcomes = [
    { name: "success", status: 204 },
    { name: "permanent rejection", status: 400 },
    { name: "retry", status: 503 },
    { name: "network failure", status: null },
  ];

  for (const outcome of outcomes) {
    for (const change of ["disable", "rotate", "disable then enable"] as const) {
      test(`${change} during ${outcome.name} preserves identity and bookkeeping`, async () => {
        const response = Promise.withResolvers<Response>();
        const started = Promise.withResolvers<void>();
        const config = makeConfig({ analytics: "enabled", installId: UUID });
        const service = makeService(config, {
          fetchImpl: () => {
            started.resolve();
            return response.promise;
          },
        });
        const ping = service.maybePing({ isInteractive: true });
        await started.promise;
        if (change === "rotate") {
          // The Settings rotation action's patch, applied outside the service
          // so the fixture id is fixed.
          await config.update({
            installId: rotateInstallId(() => rotatedId),
            analyticsCohort: "2026-08",
            lastAnalyticsPingAt: 0,
            analyticsRetryAfter: 0,
          });
          await config.save();
        } else {
          await service.setConsent("disabled");
          if (change === "disable then enable") await service.setConsent("enabled");
        }
        const expected = config.getRaw();
        const saves = config.saveCount;
        if (outcome.status === null) response.reject(new Error("offline"));
        else response.resolve(new Response(null, { status: outcome.status }));
        await ping;

        // Boolean identity assertions keep raw fixture ids out of failure logs.
        expect(config.persisted.installId === expected.installId).toBe(true);
        expect(config.rawRef.installId === expected.installId).toBe(true);
        expect(config.persisted.analytics).toBe(expected.analytics);
        expect(config.persisted.lastAnalyticsPingAt).toBe(0);
        expect(config.persisted.analyticsRetryAfter).toBe(0);
        expect(config.saveCount).toBe(saves);
      });
    }
  }

  for (const change of ["disable", "rotate"] as const) {
    test(`${change} in this process before locked completion prevents bookkeeping`, async () => {
      let persisted: KitsuneConfig = {
        ...DEFAULT_CONFIG,
        analytics: "enabled",
        installId: UUID,
      };
      const config = new ConfigServiceImpl({
        load: async () => ({ ...persisted }),
        save: async (value) => {
          persisted = { ...value };
        },
        reset: async () => {},
      });
      await config.update({ analytics: "enabled", installId: UUID });
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const service = makeService(
        {
          getRaw: () => config.getRaw(),
          update: (patch) => config.update(patch),
          save: () => config.save(),
          readPersistedAnalyticsConsent: () => config.readPersistedAnalyticsConsent(),
          recordAnalyticsPing: async (completion) => {
            started.resolve();
            await release.promise;
            return config.recordAnalyticsPing(completion);
          },
        },
        { fetchImpl: async () => new Response(null, { status: 204 }) },
      );
      const ping = service.maybePing({ isInteractive: true });
      await started.promise;
      await config.update({
        analytics: change === "disable" ? "disabled" : "enabled",
        installId: change === "disable" ? "" : rotatedId,
        lastAnalyticsPingAt: 0,
        analyticsRetryAfter: 0,
      });
      release.resolve();
      await ping;
      const saved = config.save();
      await config.flushPending();
      await saved;
      expect(persisted.installId === (change === "disable" ? "" : rotatedId)).toBe(true);
      expect(persisted.analytics).toBe(change === "disable" ? "disabled" : "enabled");
      expect(persisted.lastAnalyticsPingAt).toBe(0);
      expect(persisted.analyticsRetryAfter).toBe(0);
    });
  }
});

describe("consentPatch", () => {
  test("is pure and returns the same keys setConsent would write", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const patch = makeService(config).consentPatch("disabled");
    expect(patch).toEqual({ analytics: "disabled", installId: "", analyticsCohort: "" });
    expect(config.saveCount).toBe(0);
  });

  test("refuses to enable under DO_NOT_TRACK", () => {
    const config = makeConfig({ analytics: "unset" });
    const patch = makeService(config, { env: { DO_NOT_TRACK: "1" } }).consentPatch("enabled");
    expect(patch).toEqual({ analytics: "disabled", installId: "", analyticsCohort: "" });
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
    await settleBackgroundPing();

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
    await settleBackgroundPing();

    expect(outcome).toEqual({ kind: "pinged" });
    expect(calls).toEqual([TEST_ENDPOINT]);
  });

  test("no TTY stays unset — writes nothing, sends nothing", async () => {
    const config = makeConfig({ analytics: "unset" });
    const outcome = await makeService(config).onSessionStart({ isInteractive: false });
    await settleBackgroundPing();
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
    await settleBackgroundPing();
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
    await settleBackgroundPing();
    expect(outcome).toEqual({ kind: "quiet" });
    expect(config.rawRef.analytics).toBe("disabled");
    expect(config.rawRef.installId).toBe("");
    expect(config.rawRef.analyticsCohort).toBe("");
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
    await settleBackgroundPing();
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

  test("a cleartext http override is refused rather than redirected to the default", async () => {
    // The payload carries sha256(installId) with version/os/arch. Over http it
    // is readable on the path, and an install is followable day to day.
    expect(resolveAnalyticsEndpoint({ KUNAI_ANALYTICS_URL: "http://ingest.test/ping" })).toBe("");
    expect(resolveAnalyticsEndpoint({}, "http://ingest.test/ping")).toBe("");
    expect(resolveAnalyticsEndpoint({ KUNAI_ANALYTICS_URL: "not a url" })).toBe("");
    // Never silently redirected to Kunai's ingest: somebody who pointed their
    // installs elsewhere did not consent to sending here instead.
    expect(resolveAnalyticsEndpoint({}, "http://ingest.test/ping")).not.toBe(
      DEFAULT_ANALYTICS_ENDPOINT,
    );
  });

  test("loopback http stays allowed for local ingest development", () => {
    expect(
      resolveAnalyticsEndpoint({ KUNAI_ANALYTICS_URL: "http://localhost:3000/api/ping" }),
    ).toBe("http://localhost:3000/api/ping");
    expect(resolveAnalyticsEndpoint({}, "http://127.0.0.1:3000/api/ping")).toBe(
      "http://127.0.0.1:3000/api/ping",
    );
    expect(isTransportSafeAnalyticsEndpoint("http://[::1]:3000/api/ping")).toBe(true);
    expect(isTransportSafeAnalyticsEndpoint("http://ingest.test/ping")).toBe(false);
  });

  test("an opted-in ping cancels the unread response body", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("ok"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const service = makeService(config, {
      fetchImpl: async () => new Response(body, { status: 204 }),
    });

    await service.maybePing({ isInteractive: true });

    expect(cancelled).toBe(true);
    expect(config.rawRef.lastAnalyticsPingAt).toBeGreaterThan(0);
  });

  test("an opted-in install sends nothing to a non-https endpoint", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let calls = 0;
    const service = makeService(config, {
      endpoint: "http://ingest.test/ping",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    });

    await service.maybePing({ isInteractive: true });

    expect(calls).toBe(0);
    expect(config.rawRef.lastAnalyticsPingAt).toBe(0);
  });

  test("an opted-in install sends nothing from a non-interactive session", async () => {
    // The send gate is `maybePing`'s own, not an assumption about who called it.
    // A prior opt-in does not let a scripted or piped run emit a ping, and the
    // only thing that made that true here was the caller checking first.
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let calls = 0;
    const service = makeService(config, {
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    });

    await service.maybePing({ isInteractive: false });

    expect(calls).toBe(0);
    expect(config.rawRef.lastAnalyticsPingAt).toBe(0);
    // Nor may a suppressed ping be what mints the identifier.
    expect(config.rawRef.installId).toBe(UUID);
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
describe("the wire carries a monthly HMAC, never the stored id", () => {
  async function sentBody(config: ReturnType<typeof makeConfig>, now = NOW): Promise<string> {
    let body = "";
    const service = makeService(config, {
      now: () => now,
      fetchImpl: async (_input, init) => {
        body = String((init as RequestInit | undefined)?.body ?? "");
        return new Response(null, { status: 204 });
      },
    });
    await service.onSessionStart({ isInteractive: true });
    await settleBackgroundPing();
    return body;
  }

  test("the body sends this month's HMAC and the id stays on disk", async () => {
    const config = makeConfig({
      analytics: "enabled",
      installId: UUID,
      analyticsCohort: "2026-07",
    });
    const body = await sentBody(config);

    const sent = JSON.parse(body) as { id: string };
    expect(sent.id).toBe(monthlyWireId(UUID, "2026-08"));
    expect(sent.id).toMatch(/^[0-9a-f]{64}$/);
    // The negative that matters.
    expect(body).not.toContain(UUID);
    // The identity still persists locally, or every ping looks like a new install.
    expect(config.rawRef.installId).toBe(UUID);
  });

  test("the id is stable within a month, so daily actives count installs and not pings", () => {
    expect(monthlyWireId(UUID, "2026-11")).toBe(monthlyWireId(UUID, "2026-11"));
    expect(monthlyWireId(UUID, "2026-11")).not.toBe(monthlyWireId(crypto.randomUUID(), "2026-11"));
  });

  test("month rollover changes the id, on the IST day boundary the ingest uses", async () => {
    // 30 Nov 2026 23:59 IST and 1 Dec 2026 00:01 IST, two minutes apart.
    const lastMinuteOfNovember = Date.parse("2026-11-30T18:29:00.000Z");
    const firstMinuteOfDecember = Date.parse("2026-11-30T18:31:00.000Z");
    const november = JSON.parse(
      await sentBody(makeConfig({ analytics: "enabled", installId: UUID }), lastMinuteOfNovember),
    ) as { id: string; day: string };
    const december = JSON.parse(
      await sentBody(makeConfig({ analytics: "enabled", installId: UUID }), firstMinuteOfDecember),
    ) as { id: string; day: string };

    expect(november.day).toBe("2026-11-30");
    expect(december.day).toBe("2026-12-01");
    expect(november.id).toBe(monthlyWireId(UUID, "2026-11"));
    expect(december.id).toBe(monthlyWireId(UUID, "2026-12"));
    expect(november.id).not.toBe(december.id);
  });

  test("no month's id is derivable from another month's", () => {
    // Everything an observer of the wire could try with one month's id in
    // hand. The key is the stored id, which never leaves the machine, so none
    // of these reaches another month.
    const sha256 = (value: string) =>
      new Bun.CryptoHasher("sha256").update(value).digest("hex") as string;
    const months = Array.from({ length: 36 }, (_, i) => analyticsMonthKey(Date.UTC(2026, i, 15)));
    const ids = months.map((month) => monthlyWireId(UUID, month));
    expect(new Set(ids).size).toBe(months.length);

    for (let i = 1; i < months.length; i++) {
      const previous = ids[i - 1] ?? "";
      const month = months[i] ?? "";
      const guesses = [
        monthlyWireId(previous, month),
        sha256(previous),
        sha256(previous + month),
        sha256(month + previous),
        sha256(month),
        sha256(UUID),
      ];
      expect(guesses).not.toContain(ids[i]);
    }
  });

  test("rotating yields an identity unlinkable to the one it replaced", () => {
    const next = rotateInstallId();
    expect(next).not.toBe(UUID);
    expect(isValidInstallId(next)).toBe(true);
    expect(monthlyWireId(next, "2026-11")).not.toBe(monthlyWireId(UUID, "2026-11"));
  });

  test("the preview shows what is actually sent, not the stored id", async () => {
    // `/analytics show` renders this under "Exact JSON that would be sent", and
    // the setup screen shows the same shape. Previewing the raw UUID would make
    // that disclosure false on the one surface whose entire job is telling the
    // user what leaves their machine.
    const config = makeConfig({
      analytics: "enabled",
      installId: UUID,
      analyticsCohort: "2026-07",
    });
    const preview = makeService(config).describePayload();
    expect(preview.id).not.toBe(UUID);

    // And it must match the real body byte for byte.
    expect(await sentBody(config)).toBe(JSON.stringify(preview));
  });

  test("previewing still mints nothing for someone who has not opted in", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    expect(makeService(config).describePayload().id).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
    expect(config.rawRef.installId).toBe("");
    expect(config.rawRef.analyticsCohort).toBe("");
  });

  test("the payload is exactly the six documented v2 keys, with no timestamp", async () => {
    const body = await sentBody(makeConfig({ analytics: "enabled", installId: UUID }));
    expect(Object.keys(JSON.parse(body) as object).sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
    expect(body).not.toContain('"ts"');
  });
});

describe("cohort", () => {
  test("the enable keystroke sets it to the month it was pressed in", async () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    await makeService(config).setConsent("enabled");
    expect(config.rawRef.analyticsCohort).toBe("2026-08");
  });

  test("disabling clears it with the id, so a re-enable is a new install", async () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const service = makeService(config);
    await service.setConsent("enabled");
    await service.setConsent("disabled");
    expect(config.rawRef.analyticsCohort).toBe("");
    expect(config.rawRef.installId).toBe("");

    const later = makeService(config, { now: () => Date.UTC(2026, 9, 3) });
    await later.setConsent("enabled");
    expect(config.rawRef.analyticsCohort).toBe("2026-10");
  });

  test("affirming an enable that already holds keeps its cohort", async () => {
    const config = makeConfig({
      analytics: "enabled",
      installId: UUID,
      analyticsCohort: "2026-03",
    });
    await makeService(config).setConsent("enabled");
    expect(config.rawRef.analyticsCohort).toBe("2026-03");
    expect(config.rawRef.installId).toBe(UUID);
  });

  test("rotation starts a new cohort and cadence", async () => {
    const config = makeConfig({
      analytics: "enabled",
      installId: UUID,
      analyticsCohort: "2026-03",
      lastAnalyticsPingAt: NOW - 1000,
    });
    const { installId } = await makeService(config).rotateIdentity();
    expect(installId).not.toBe(UUID);
    expect(config.rawRef.installId).toBe(installId);
    expect(config.rawRef.analyticsCohort).toBe("2026-08");
    expect(config.rawRef.lastAnalyticsPingAt).toBe(0);
  });

  test("an install that opted in before cohorts existed keeps the cohort its first v2 ping sent", async () => {
    // The documented upgrade seam: counted as new once, in its upgrade month.
    const config = makeConfig({ analytics: "enabled", installId: UUID, analyticsCohort: "" });
    const service = makeService(config, {
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    expect(service.describePayload().cohort).toBe("2026-08");
    await service.maybePing({ isInteractive: true });
    expect(config.rawRef.analyticsCohort).toBe("2026-08");
  });

  for (const [name, env, isInteractive] of [
    ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }, true],
    ["CI", { CI: "true" }, true],
    ["a non-interactive session", {}, false],
  ] as const) {
    test(`${name} never creates an id or a cohort and never sends`, async () => {
      const config = makeConfig({ analytics: "unset", installId: "" });
      let calls = 0;
      const service = makeService(config, {
        env,
        fetchImpl: async () => {
          calls += 1;
          return new Response(null, { status: 204 });
        },
      });
      await service.onSessionStart({ isInteractive });
      await service.maybePing({ isInteractive });
      service.describePayload();
      await settleBackgroundPing();
      expect(config.rawRef.installId).toBe("");
      expect(config.rawRef.analyticsCohort).toBe("");
      expect(calls).toBe(0);
    });
  }
});

describe("os", () => {
  test("an Android runtime reports android, not linux", () => {
    expect(analyticsOs("linux", { TERMUX_VERSION: "0.118.1" })).toBe("android");
    expect(analyticsOs("linux", { PREFIX: "/data/data/com.termux/files/usr" })).toBe("android");
    expect(analyticsOs("android", {})).toBe("android");
    expect(analyticsOs("linux", {})).toBe("linux");
    expect(analyticsOs("darwin", {})).toBe("darwin");
  });

  test("an Android install sends os: android", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let body = "";
    const service = new UsageAnalyticsService({
      config,
      currentVersion: "0.4.0",
      endpoint: TEST_ENDPOINT,
      pingLog: memoryPingLog(),
      now: () => NOW,
      platform: { os: analyticsOs("linux", { TERMUX_VERSION: "0.118.1" }), arch: "arm64" },
      env: {},
      fetchImpl: async (_input, init) => {
        body = String(init?.body ?? "");
        return new Response(null, { status: 204 });
      },
    });
    await service.maybePing({ isInteractive: true });
    expect((JSON.parse(body) as { os: string }).os).toBe("android");
  });
});

describe("local ping log", () => {
  const sendingService = (config: ReturnType<typeof makeConfig>, pingLog: PingLog) =>
    makeService(config, {
      pingLog,
      fetchImpl: async () => new Response(null, { status: 204 }),
    });

  test("records every sent body exactly, while enabled", async () => {
    const pingLog = memoryPingLog();
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let sent = "";
    const service = makeService(config, {
      pingLog,
      fetchImpl: async (_input, init) => {
        sent = String(init?.body ?? "");
        return new Response(null, { status: 204 });
      },
    });
    await service.maybePing({ isInteractive: true });
    expect(pingLog.entries).toEqual([
      { sentAt: new Date(NOW).toISOString(), endpoint: TEST_ENDPOINT, body: sent },
    ]);
  });

  test("is deleted on disable", async () => {
    const pingLog = memoryPingLog();
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const service = sendingService(config, pingLog);
    await service.maybePing({ isInteractive: true });
    expect(pingLog.exists).toBe(true);
    await service.setConsent("disabled");
    expect(pingLog.exists).toBe(false);
  });

  test("is deleted on rotation", async () => {
    const pingLog = memoryPingLog();
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const service = sendingService(config, pingLog);
    await service.maybePing({ isInteractive: true });
    await service.rotateIdentity();
    expect(pingLog.exists).toBe(false);
  });

  test("a log left behind by a disable elsewhere is removed at the next start", async () => {
    const pingLog = memoryPingLog();
    await pingLog.append({ sentAt: "x", endpoint: TEST_ENDPOINT, body: "{}" });
    const config = makeConfig({ analytics: "disabled", installId: "" });
    await makeService(config, { pingLog }).onSessionStart({ isInteractive: true });
    await settleBackgroundPing();
    expect(pingLog.exists).toBe(false);
  });

  test("is never written while not enabled, and the preview writes nothing", async () => {
    const pingLog = memoryPingLog();
    const config = makeConfig({ analytics: "unset", installId: "" });
    const service = makeService(config, { pingLog });
    service.describePayload();
    await service.onSessionStart({ isInteractive: true });
    await service.maybePing({ isInteractive: true });
    await settleBackgroundPing();
    expect(pingLog.exists).toBe(false);
  });

  test("a ping the log cannot record is not sent", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    let calls = 0;
    const service = makeService(config, {
      pingLog: {
        append: async () => {
          throw new Error("read-only data dir");
        },
        read: async () => [],
        remove: async () => {},
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    });
    await service.maybePing({ isInteractive: true });
    expect(calls).toBe(0);
    // Not consumed: the next launch tries again.
    expect(config.rawRef.lastAnalyticsPingAt).toBe(0);
  });
});
