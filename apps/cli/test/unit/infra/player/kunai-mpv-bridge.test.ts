import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRIDGE_PATH = join(import.meta.dir, "../../../../assets/mpv/kunai-bridge.lua");

describe("kunai mpv bridge resume prompt", () => {
  test("keeps the visible resume prompt aligned with the Alt+R playback shortcut", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");

    expect(source).toContain("[Alt+R]");
    expect(source).toContain('mp.add_forced_key_binding("Alt+r", "kunai-resume-alt-r"');
    expect(source).toContain("Continue from last history point");
  });
});
