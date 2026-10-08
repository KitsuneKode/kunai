import { expect, test } from "bun:test";

import {
  UsageAnalyticsService,
  UNSET_INSTALL_ID_PLACEHOLDER,
} from "@/services/analytics/usage-analytics-service";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigStore";

const ID = "11111111-2222-4333-8444-555555555555";
const ROTATED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

for (const change of ["disable", "rotate"]) {
  test(`local ${change} during the completion write does not receive old cadence`, async () => {
    const shared = profile();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const config = new ConfigServiceImpl({
      ...shared.store,
      save: async (value) => {
        started.resolve();
        await release.promise;
        await shared.store.save(value);
      },
    });
    await config.update({ analytics: "enabled", installId: ID });
    const completion = config.recordAnalyticsPing({
      installId: ID,
      lastAnalyticsPingAt: 100_000,
      analyticsRetryAfter: 0,
    });
    try {
      await started.promise;
      await config.update({
        analytics: change === "disable" ? "disabled" : "enabled",
        installId: change === "disable" ? "" : ROTATED,
      });
    } finally {
      release.resolve();
    }
    expect(await completion).toBe(false);
    expect(config.getRaw().lastAnalyticsPingAt).toBe(0);
    expect(config.getRaw().installId).toBe(change === "disable" ? "" : ROTATED);
  });
}

function profile(installId = ID) {
  let disk: KitsuneConfig = {
    ...DEFAULT_CONFIG,
    analytics: "enabled",
    analyticsNoticeShown: true,
    installId,
  };
  let tail = Promise.resolve();
  const store = {
    load: async () => ({ ...disk }),
    save: async (value: KitsuneConfig) => {
      disk = { ...value };
    },
    reset: async () => {},
    withLock: async <T>(fn: () => Promise<T>): Promise<T> => {
      const next = tail.then(fn);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  return { store, read: () => ({ ...disk }) };
}

function service(config: ConfigServiceImpl, fetchImpl: () => Promise<Response>) {
  return new UsageAnalyticsService({
    config,
    currentVersion: "0.3.0",
    endpoint: "https://analytics.example.test/api/ping",
    env: {},
    fetchImpl,
    now: () => 100_000,
  });
}

for (const status of [204, 400, 503]) {
  for (const change of ["disable", "rotate", "disable then enable"] as const) {
    test(`a sibling ${change} survives ping completion (${status})`, async () => {
      const shared = profile();
      const sender = await ConfigServiceImpl.load(shared.store);
      const sibling = await ConfigServiceImpl.load(shared.store);
      const started = Promise.withResolvers<void>();
      const response = Promise.withResolvers<Response>();
      const ping = service(sender, () => {
        started.resolve();
        return response.promise;
      }).maybePing({ isInteractive: true });
      await started.promise;
      await sibling.update({
        analytics: change === "disable" ? "disabled" : "enabled",
        installId: change === "disable" ? "" : ROTATED,
        mpvInProcessStreamReconnectMaxAttempts: 0,
      });
      const saved = sibling.save();
      await sibling.flushPending();
      await saved;
      const expected = shared.read();
      response.resolve(new Response(null, { status }));
      await ping;
      expect(shared.read()).toEqual(expected);
    });
  }
}

for (const invalid of ["", "workstation", "aa:bb:cc:dd:ee:ff"]) {
  test(`invalid identity ${JSON.stringify(invalid)} sends nothing and is never silently repaired`, async () => {
    const shared = profile(invalid);
    const config = await ConfigServiceImpl.load(shared.store);
    let sends = 0;
    const analytics = service(config, async () => {
      sends += 1;
      return new Response(null, { status: 204 });
    });
    const expected = shared.read();
    await analytics.maybePing({ isInteractive: true });
    await analytics.maybePing({ isInteractive: true });
    expect(sends).toBe(0);
    expect(shared.read()).toEqual(expected);
    expect(analytics.describePayload().installId).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
  });
}

for (const status of [204, 400, 503]) {
  test(`unchanged persisted identity receives cadence (${status}) and preserves sibling settings`, async () => {
    const shared = profile();
    const sender = await ConfigServiceImpl.load(shared.store);
    const sibling = await ConfigServiceImpl.load(shared.store);
    const response = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const ping = service(sender, () => {
      started.resolve();
      return response.promise;
    }).maybePing({ isInteractive: true });
    await started.promise;
    await sibling.update({ mpvInProcessStreamReconnectMaxAttempts: 0 });
    const saved = sibling.save();
    await sibling.flushPending();
    await saved;
    response.resolve(new Response(null, { status }));
    await ping;
    expect(shared.read().installId).toBe(ID);
    expect(shared.read().mpvInProcessStreamReconnectMaxAttempts).toBe(0);
    expect(shared.read().lastAnalyticsPingAt).toBe(status === 503 ? 0 : 100_000);
    expect(shared.read().analyticsRetryAfter).toBe(status === 503 ? 1_000_000 : 0);
  });
}
