import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Container } from "@/container";
import { createContainer, disposeContainer } from "@/container";
import {
  bundledKunaiMpvBridgePath,
  ensureUserKunaiMpvBridge,
} from "@/infra/player/kunai-mpv-bridge";
import { getKunaiPaths } from "@kunai/storage";

import { diffProfile, realProfileTargets, snapshotProfile } from "../helpers/profile-guard";
import { applyStorageRootEnv } from "../helpers/storage-env";

/**
 * `KUNAI_CONFIG_DIR` is a dedicated profile root, not a config-directory
 * override. This is the regression: a run pointed at `<root>` must build its
 * whole layout under `<root>/{config,data,cache}` and never touch the
 * platform-default profile that the same environment still resolves — even
 * when that profile exists and its databases are not valid SQLite.
 *
 * The fake "default" profile is seeded with sentinel bytes and diffed with the
 * same snapshot/diff machinery the real-profile guard uses, so any stray write
 * to it is a failure with a named path, not a vague mismatch.
 */
describe("KUNAI_CONFIG_DIR profile root", () => {
  let root: string;
  let restoreEnv: () => void;
  let previousOverride: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kunai-storage-override-"));
    restoreEnv = applyStorageRootEnv(join(root, "home"));
    // The override must start absent both ways: a leaked value from an outer
    // shell would corrupt the *default* profile resolution this test pins,
    // not just move the one under test.
    previousOverride = process.env.KUNAI_CONFIG_DIR;
    delete process.env.KUNAI_CONFIG_DIR;
  });

  afterEach(() => {
    if (previousOverride === undefined) delete process.env.KUNAI_CONFIG_DIR;
    else process.env.KUNAI_CONFIG_DIR = previousOverride;
    restoreEnv();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  test("startup under a profile root writes only the profile, never the default layout", async () => {
    // Seed a plausible default profile with sentinel bytes: valid-looking
    // config, deliberately invalid SQLite, a bridge script. If anything in
    // startup still resolves the default layout, the diff names the write.
    // Resolved while KUNAI_CONFIG_DIR is still unset (beforeEach), so this is
    // the platform-default profile of the applied storage root.
    const defaults = getKunaiPaths();
    const targets = realProfileTargets();
    for (const dir of targets.roots) mkdirSync(dir, { recursive: true });
    mkdirSync(dirname(defaults.mpvBridgePath), { recursive: true });
    writeFileSync(defaults.configPath, '{"theme":"seed-theme","seeded":true}\n');
    writeFileSync(defaults.dataDbPath, "sentinel-not-a-sqlite-data-db\n");
    writeFileSync(defaults.cacheDbPath, "sentinel-not-a-sqlite-cache-db\n");
    writeFileSync(defaults.mpvBridgePath, "-- sentinel bridge script\n");
    const before = snapshotProfile(targets.roots, targets.files);
    const seededBytes = new Map(targets.files.map((file) => [file, readFileSync(file)] as const));

    // The run-under-test: a sibling of the seeded profile's home, resolved
    // only through the env, exactly as a user-facing startup would.
    const profileRoot = join(root, "profile");
    process.env.KUNAI_CONFIG_DIR = profileRoot;

    let container: Container | undefined;
    try {
      container = await createContainer({
        providerModulesOverride: [],
        searchServiceDefinitions: [],
      });
      await container.config.update({ theme: "sakura" });
      await container.config.save();
      await container.config.flushPending();
      await ensureUserKunaiMpvBridge(bundledKunaiMpvBridgePath());
    } finally {
      await disposeContainer(container);
    }

    // Assert against literals, not re-resolved paths: a resolution bug must
    // fail here, not quietly agree with itself.
    const configPath = join(profileRoot, "config", "config.json");
    const dataDb = join(profileRoot, "data", "kunai-data.sqlite");
    const cacheDb = join(profileRoot, "cache", "kunai-cache.sqlite");
    const bridge = join(profileRoot, "config", "mpv", "kunai-bridge.lua");
    for (const file of [configPath, dataDb, cacheDb, bridge]) {
      expect(existsSync(file)).toBe(true);
    }
    const persisted = JSON.parse(readFileSync(configPath, "utf8"));
    expect(persisted.theme).toBe("sakura");
    expect(readFileSync(bridge, "utf8").length).toBeGreaterThan(0);

    // The seeded default profile is byte-for-byte untouched.
    const drift = diffProfile(before, snapshotProfile(targets.roots, targets.files));
    expect(drift).toEqual([]);
    for (const [file, bytes] of seededBytes) {
      expect(readFileSync(file)).toEqual(bytes);
    }
  });
});
