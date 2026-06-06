import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRIDGE_PATH = join(import.meta.dir, "../../../../assets/mpv/kunai-bridge.lua");

describe("kunai mpv bridge resume prompt", () => {
  test("keeps the visible resume prompt aligned with the Alt+R playback shortcut", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");

    expect(source).toContain("[Alt+R]");
    expect(source).toContain('mp.add_forced_key_binding("Alt+r", "kunai-resume-alt-r"');
    expect(source).toContain("Resume at ");
    expect(source).toContain("from where you left off");
  });
});

describe("kunai mpv bridge episode navigation", () => {
  test("keeps manual next and previous snappy instead of delaying with countdown timers", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");

    expect(source).not.toContain('Loading " .. noun .. " episode in');
    expect(source).not.toContain("mp.add_timeout(1, function()");
    expect(source).toContain("if not navigation_allowed(action) then");
    expect(source).toContain('mp.commandv("stop")');
  });

  test("sets the loading overlay before stopping mpv for manual navigation", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");
    const transitionStart = source.indexOf("local function start_episode_transition(action)");
    const transitionEnd = source.indexOf("local function do_next()", transitionStart);
    const transitionSource = source.slice(transitionStart, transitionEnd);

    expect(transitionSource).toContain("if not navigation_allowed(action) then");
    expect(transitionSource.indexOf('mp.set_property("user-data/kunai-loading"')).toBeGreaterThan(
      transitionSource.indexOf("if not navigation_allowed(action) then"),
    );
    expect(transitionSource.indexOf('mp.set_property("user-data/kunai-loading"')).toBeLessThan(
      transitionSource.indexOf('mp.commandv("stop")'),
    );
    expect(transitionSource.indexOf("signal(action)")).toBeLessThan(
      transitionSource.indexOf('mp.commandv("stop")'),
    );
  });

  test("clears transient loading and resume bridge state on file-loaded", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");
    const eventStart = source.indexOf('mp.register_event("file-loaded"');
    const eventEnd = source.indexOf("end)", eventStart);
    const fileLoadedSource = source.slice(eventStart, eventEnd);

    expect(fileLoadedSource).toContain('mp.set_property("user-data/kunai-loading", "")');
    expect(fileLoadedSource).toContain('mp.set_property("user-data/kunai-resume-at", 0)');
    expect(fileLoadedSource).toContain('mp.set_property("user-data/kunai-resume-choice", "")');
  });
});
