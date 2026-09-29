import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundledKunaiMpvBridgePath,
  ensureUserKunaiMpvBridge,
  isEphemeralKunaiLuaScript,
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

test("isEphemeralKunaiLuaScript accepts only a generated keys script directly in tmpdir", () => {
  const tmp = tmpdir();

  expect(isEphemeralKunaiLuaScript(join(tmp, "kunai-mpv-keys-1234-abc.lua"))).toBe(true);
  expect(isEphemeralKunaiLuaScript(null)).toBe(false);
  expect(isEphemeralKunaiLuaScript(undefined)).toBe(false);
});

test("isEphemeralKunaiLuaScript refuses paths that only look close", () => {
  const tmp = tmpdir();

  // A directory named for the prefix must not make its children deletable.
  expect(isEphemeralKunaiLuaScript(join(tmp, "kunai-mpv-keys-abc", "anything.lua"))).toBe(false);
  // User-owned / persistent bridge scripts are never ephemeral.
  expect(isEphemeralKunaiLuaScript(join(tmp, "kunai-bridge.lua"))).toBe(false);
  expect(isEphemeralKunaiLuaScript(join(tmp, "kunai-mpv-keys-abc.txt"))).toBe(false);
  expect(isEphemeralKunaiLuaScript(join(tmp, "kunai-mpv-keys-abc.lua", "nested.lua"))).toBe(false);
  // A path that merely contains the prefix somewhere in the middle.
  expect(isEphemeralKunaiLuaScript(join(tmp, "sub", "kunai-mpv-keys-x.lua"))).toBe(false);
  // The user's config-dir bridge copy must never match.
  expect(isEphemeralKunaiLuaScript("/home/user/.config/kunai/mpv/kunai-bridge.lua")).toBe(false);
});
