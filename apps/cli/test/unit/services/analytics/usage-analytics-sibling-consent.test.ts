import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { FileStorage } from "@/infra/storage/FileStorage";
import { filePingLog, type PingLog } from "@/services/analytics/ping-log";
import {
  type AnalyticsFetch,
  UsageAnalyticsService,
} from "@/services/analytics/usage-analytics-service";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { ConfigStoreImpl } from "@/services/persistence/ConfigStoreImpl";

import { memoryPingLog } from "../../../support/analytics-fixtures";

/**
 * Two kunai instances share one config.json. Instance A loaded consent at
 * startup; instance B then disables analytics or rotates the install id on
 * disk. A's next ping must not go out under consent or an identity that is no
 * longer on disk — the pre-send check, not only the post-send bookkeeping.
 *
 * Real `FileStorage` on a throwaway directory, so the store is the production
 * one and nothing touches the developer's profile.
 */

const UUID = "11111111-2222-4333-8444-555555555555";
const ROTATED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TEST_ENDPOINT = "https://analytics.example.test/api/ping";
const NOW = Date.UTC(2026, 9, 8);
const ENABLED: Partial<KitsuneConfig> = {
  analytics: "enabled",
  installId: UUID,
  analyticsNoticeShown: true,
};

const cleanups: string[] = [];

afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function sandbox(seed: Partial<KitsuneConfig>) {
  const directory = await mkdtemp(join(tmpdir(), "kunai-analytics-siblings-"));
  cleanups.push(directory);
  const configPath = join(directory, "config.json");
  const store = () => new ConfigStoreImpl(new FileStorage({ config: configPath }));
  await store().save({ ...DEFAULT_CONFIG, ...seed });
  return {
    configPath,
    load: () => ConfigServiceImpl.load(store()),
    readDisk: (): Promise<Partial<KitsuneConfig>> => store().load(),
  };
}

function countingService(config: ConfigServiceImpl) {
  const sent = { count: 0 };
  const fetchImpl: AnalyticsFetch = async () => {
    sent.count += 1;
    return new Response(null, { status: 204 });
  };
  const service = new UsageAnalyticsService({
    pingLog: memoryPingLog(),
    config,
    currentVersion: "0.3.0",
    endpoint: TEST_ENDPOINT,
    fetchImpl,
    now: () => NOW,
    platform: { os: "linux", arch: "x64" },
    env: {},
  });
  return { service, sent };
}

/** Writes a patch the way a sibling instance would: update, then flush to disk. */
async function commitFromSibling(config: ConfigServiceImpl, patch: Partial<KitsuneConfig>) {
  await config.update(patch);
  const saved = config.save();
  await config.flushPending();
  await saved;
}

describe("pre-send persisted consent check", () => {
  test("a sibling disable before the ping means nothing is sent", async () => {
    const dir = await sandbox(ENABLED);
    const a = await dir.load();
    const b = await dir.load();
    const { service, sent } = countingService(a);

    await commitFromSibling(b, { analytics: "disabled", installId: "" });
    await service.maybePing({ isInteractive: true });

    expect(sent.count).toBe(0);
    const disk = await dir.readDisk();
    expect(disk.analytics).toBe("disabled");
    // Boolean identity assertions keep raw fixture ids out of failure logs.
    expect(disk.installId === "").toBe(true);
    expect(disk.lastAnalyticsPingAt ?? 0).toBe(0);
  });

  test("a sibling rotation before the ping sends nothing under the old identity", async () => {
    const dir = await sandbox(ENABLED);
    const a = await dir.load();
    const b = await dir.load();
    const { service, sent } = countingService(a);

    await commitFromSibling(b, { installId: ROTATED });
    await service.maybePing({ isInteractive: true });

    expect(sent.count).toBe(0);
    const disk = await dir.readDisk();
    expect(disk.installId === ROTATED).toBe(true);
    expect(disk.lastAnalyticsPingAt ?? 0).toBe(0);
  });

  test("a config.json that can no longer be read sends nothing", async () => {
    const dir = await sandbox(ENABLED);
    const a = await dir.load();
    const { service, sent } = countingService(a);

    await writeFile(dir.configPath, "{ not json");
    await service.maybePing({ isInteractive: true });

    expect(sent.count).toBe(0);
  });

  test("an unsaved local enable is not sent while disk still says disabled", async () => {
    const dir = await sandbox({ analytics: "disabled", installId: "", analyticsNoticeShown: true });
    const a = await dir.load();
    // Enabled in this process, not yet saved: the disk has not recorded consent.
    await a.update({ analytics: "enabled", installId: UUID });
    const { service, sent } = countingService(a);

    await service.maybePing({ isInteractive: true });

    expect(sent.count).toBe(0);
    // The check only reads; it does not overwrite the pending local intent.
    expect(a.getRaw().analytics).toBe("enabled");
  });

  test("enabled with no install id on either side sends nothing and mints nothing", async () => {
    const dir = await sandbox({ analytics: "enabled", installId: "", analyticsNoticeShown: true });
    const a = await dir.load();
    const { service, sent } = countingService(a);

    await service.maybePing({ isInteractive: true });

    expect(sent.count).toBe(0);
    expect((await dir.readDisk()).installId ?? "").toBe("");
  });

  test("an undisturbed enabled install still sends once and records the cadence", async () => {
    const dir = await sandbox(ENABLED);
    const a = await dir.load();
    const { service, sent } = countingService(a);

    await service.maybePing({ isInteractive: true });

    expect(sent.count).toBe(1);
    const disk = await dir.readDisk();
    expect(disk.lastAnalyticsPingAt).toBe(NOW);
    expect(disk.analytics).toBe("enabled");
    expect(disk.installId === UUID).toBe(true);
  });
});

describe("the local ping log and rotation respect a sibling's disable", () => {
  function serviceWith(config: ConfigServiceImpl, pingLog: PingLog) {
    const sent = { count: 0 };
    const service = new UsageAnalyticsService({
      pingLog,
      config,
      currentVersion: "0.4.0",
      endpoint: TEST_ENDPOINT,
      fetchImpl: async () => {
        sent.count += 1;
        return new Response(null, { status: 204 });
      },
      now: () => NOW,
      platform: { os: "linux", arch: "x64" },
      env: {},
    });
    return { service, sent };
  }

  test("a disable that lands while the log is written sends nothing and leaves no log", async () => {
    const dir = await sandbox(ENABLED);
    const logPath = join(dirname(dir.configPath), "analytics-pings.json");
    const a = await dir.load();
    const b = await dir.load();
    const sibling = serviceWith(b, filePingLog(logPath));
    const real = filePingLog(logPath);
    // The sibling's disable (which removes the log) runs inside A's append,
    // so A's entry is written after the file was already removed.
    const racingLog: PingLog = {
      ...real,
      append: async (entry) => {
        await sibling.service.setConsent("disabled");
        await real.append(entry);
      },
    };
    const { service, sent } = serviceWith(a, racingLog);

    await service.maybePing({ isInteractive: true });

    expect(sent.count).toBe(0);
    expect(existsSync(logPath)).toBe(false);
    expect((await dir.readDisk()).analytics).toBe("disabled");
  });

  test("rotating after a sibling disabled writes nothing back beside disabled", async () => {
    const dir = await sandbox({ ...ENABLED, analyticsCohort: "2026-10" });
    const a = await dir.load();
    const b = await dir.load();
    await serviceWith(b, memoryPingLog()).service.setConsent("disabled");

    // A's memory still says enabled, which is all the Settings gate reads.
    expect(a.getRaw().analytics).toBe("enabled");
    const rotated = await serviceWith(a, memoryPingLog()).service.rotateIdentity();

    expect(rotated).toBeNull();
    const disk = await dir.readDisk();
    expect(disk.analytics).toBe("disabled");
    expect(disk.installId === "").toBe(true);
    expect(disk.analyticsCohort).toBe("");
    // The refused rotation refreshed A from the file, so it stops offering it.
    expect(a.getRaw().analytics).toBe("disabled");
  });

  test("rotating while the file still says enabled writes the new identity", async () => {
    const dir = await sandbox({ ...ENABLED, analyticsCohort: "2026-03" });
    const a = await dir.load();
    const rotated = await serviceWith(a, memoryPingLog()).service.rotateIdentity();

    expect(rotated).not.toBeNull();
    const disk = await dir.readDisk();
    expect(disk.analytics).toBe("enabled");
    expect(disk.installId === rotated?.installId).toBe(true);
    expect(disk.analyticsCohort).toBe("2026-10");
  });
});
