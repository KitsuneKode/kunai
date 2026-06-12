import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundledKunaiMpvBridgePath,
  ensureUserKunaiMpvBridge,
} from "@/infra/player/kunai-mpv-bridge";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("bundledKunaiMpvBridgePath resolves to a readable bridge asset", async () => {
  const path = bundledKunaiMpvBridgePath();
  expect(existsSync(path)).toBe(true);
  expect(await Bun.file(path).text()).toContain("kunai");
});

test("ensureUserKunaiMpvBridge materializes the bridge at the dest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-bridge-"));
  made.push(dir);
  const dest = join(dir, "mpv", "kunai-bridge.lua");

  await ensureUserKunaiMpvBridge(bundledKunaiMpvBridgePath(), dest);

  expect(existsSync(dest)).toBe(true);
  expect((await Bun.file(dest).text()).length).toBeGreaterThan(0);
});
