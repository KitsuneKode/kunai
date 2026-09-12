import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildKunaiBridgeScriptOptsArg,
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

test("buildKunaiBridgeScriptOptsArg joins entries mpv can actually parse", () => {
  expect(buildKunaiBridgeScriptOptsArg({ margin_bottom: "40", chip_width: "12" })).toBe(
    "kunai-bridge-margin_bottom=40,kunai-bridge-chip_width=12",
  );
  expect(buildKunaiBridgeScriptOptsArg(undefined)).toBeUndefined();
  expect(buildKunaiBridgeScriptOptsArg({ margin_bottom: "" })).toBeUndefined();
});

test("buildKunaiBridgeScriptOptsArg drops an entry carrying mpv's separators", () => {
  // `--script-opts` splits on commas and a key on its first `=`, with no escape
  // for either. Emitting such an entry does not fail loudly: it redefines the
  // neighbouring option or truncates this one.
  expect(
    buildKunaiBridgeScriptOptsArg({
      margin_bottom: "40",
      "chip,width": "12",
      "chip=width": "12",
      label: "a,b",
    }),
  ).toBe("kunai-bridge-margin_bottom=40");
  expect(buildKunaiBridgeScriptOptsArg({ "chip,width": "12" })).toBeUndefined();
});

test("ensureUserKunaiMpvBridge materializes the bridge at the dest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-bridge-"));
  made.push(dir);
  const dest = join(dir, "mpv", "kunai-bridge.lua");

  await ensureUserKunaiMpvBridge(bundledKunaiMpvBridgePath(), dest);

  expect(existsSync(dest)).toBe(true);
  expect((await Bun.file(dest).text()).length).toBeGreaterThan(0);
});
