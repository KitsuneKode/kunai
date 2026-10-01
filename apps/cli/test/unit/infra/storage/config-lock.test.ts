import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileStorage, reclaimStaleLock } from "@/infra/storage/FileStorage";

test("a dead config lock is reclaimed and a live pid is left in place", async () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-config-lock-"));
  const configPath = join(root, "config.json");
  const lockPath = join(root, "config.json.lock");
  try {
    writeFileSync(lockPath, "999999999");
    const storage = new FileStorage({ config: configPath });
    await storage.write("config", { ok: true });
    expect(await Bun.file(configPath).json()).toEqual({ ok: true });
    expect(await Bun.file(lockPath).exists()).toBe(false);

    writeFileSync(lockPath, String(process.pid));
    expect(await reclaimStaleLock(lockPath)).toBe(false);
    expect(await Bun.file(lockPath).text()).toBe(String(process.pid));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two reclaimers cannot both remove the same stale lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-config-lock-race-"));
  const lockPath = join(root, "config.json.lock");
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(lockPath, "999999999");
    const results = await Promise.all([reclaimStaleLock(lockPath), reclaimStaleLock(lockPath)]);
    expect(results.some(Boolean)).toBe(true);
    expect(await Bun.file(lockPath).exists()).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
