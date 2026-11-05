import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRIDGE_PATH = join(import.meta.dir, "../../../../assets/mpv/kunai-bridge.lua");

function testWithLua(name: string, run: () => Promise<void>): void {
  test.skipIf(!Bun.which("lua"))(name, run);
}

describe("kunai mpv bridge resume prompt", () => {
  test("resume prompt offers resume (Enter / middle-click) and dismiss (Esc / left-click)", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");

    // Visible hint advertises the resume + dismiss affordances.
    expect(source).toContain("resume");
    expect(source).toContain("dismiss");
    expect(source).toContain("Resume at ");
    expect(source).toContain("from where you left off");

    // Alt+R still resumes (kept for parity with the in-app shortcut)…
    expect(source).toContain('mp.add_forced_key_binding("Alt+r", "kunai-resume-alt-r"');
    // …plus the mouse + Esc affordances, scoped to the prompt.
    expect(source).toContain('mp.add_forced_key_binding("MBTN_MID", "kunai-resume-mbtn-mid"');
    expect(source).toContain('mp.add_forced_key_binding("MBTN_LEFT", "kunai-resume-mbtn-left"');
    expect(source).toContain('mp.add_forced_key_binding("ESC", "kunai-resume-esc"');
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

describe("kunai mpv bridge server and audio cycling", () => {
  test("provides in-player cycling for servers and audio with fallback to terminal selection", () => {
    const source = readFileSync(BRIDGE_PATH, "utf8");

    // In-player server cycling bindings
    expect(source).toContain('mp.add_forced_key_binding("c", "kunai-cycle-source"');
    expect(source).toContain('mp.add_forced_key_binding("C", "kunai-cycle-source-shift"');

    // Terminal source selection bindings
    expect(source).toContain('mp.add_forced_key_binding("s", "kunai-source"');
    expect(source).toContain('mp.add_forced_key_binding("S", "kunai-source-shift"');

    // Audio cycling bindings
    expect(source).toContain('mp.add_forced_key_binding("a", "kunai-cycle-audio"');
    expect(source).toContain('mp.add_forced_key_binding("A", "kunai-cycle-audio-shift"');
    expect(source).toContain('mp.add_forced_key_binding("d", "kunai-cycle-audio-alt"');
    expect(source).toContain('mp.add_forced_key_binding("D", "kunai-cycle-audio-alt-shift"');

    // Logic checks
    expect(source).toContain('signal("cycle-source")');
    expect(source).toContain('signal("cycle-audio")');
    expect(source).toContain('signal("source")');
    expect(source).toContain("has_multiple_internal_audio_tracks");
  });
});

// Execute the shipped Lua against a deterministic mp API, then feed its payload
// through the same parser used by both persistent and one-shot players.
// Test registration must record missing Lua as a skip rather than a silent pass.
// eslint-disable-next-line anti-slop/no-module-load-env-read
testWithLua(
  "embedded audio keys publish intent while startup and unknown tracks do not",
  async () => {
    const { parseMpvAudioIntent } = await import("@/infra/player/mpv-audio-intent");
    const proc = Bun.spawn(["lua", "-", BRIDGE_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(String.raw`
local observers, keys, properties = {}, {}, {}
local tracks = { {id=1,type="audio",lang="en",selected=true}, {id=2,type="audio",lang="ja",selected=false} }
package.preload["mp.utils"] = function() return {format_json = function(v)
  return string.format('{"id":%d,"language":%q,"path":%q,"revision":%d}', v.id,v.language,v.path,v.revision)
end} end
mp = {
  create_osd_overlay=function() return {update=function() end,remove=function() end} end,
  observe_property=function(name,kind,callback) observers[name]=callback end,
  register_event=function() end,
  add_forced_key_binding=function(key,name,callback) keys[key]=callback end,
  add_key_binding=function() end,
  get_property_native=function(name,default) if name=="track-list" then return tracks end return default end,
  get_property=function(name,default) if name=="path" then return "https://example.test/current.mkv" end return default end,
  set_property=function(name,value) properties[name]=value end,
  commandv=function(command,name) if command=="cycle" and name=="audio" then
    tracks[1].selected=false; tracks[2].selected=true
  end end,
}
dofile(arg[1])
observers.audio("audio",1)
assert(properties["user-data/kunai-audio-intent"]==nil,"startup observation wrote intent")
keys.a()
assert(properties["user-data/kunai-audio-intent"]~=nil,"explicit cycle did not write intent")
print(properties["user-data/kunai-audio-intent"])
keys.a()
print(properties["user-data/kunai-audio-intent"])
properties["user-data/kunai-audio-intent"]=nil
tracks[2].lang=nil
keys.a()
assert(properties["user-data/kunai-audio-intent"]==nil,"unknown language invented intent")
`);
    proc.stdin.end();
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const [first, second] = stdout.trim().split("\n");
    expect(first).not.toBe(second); // Repeated explicit picks remain observable.
    expect(parseMpvAudioIntent(first, "https://example.test/current.mkv")).toEqual({
      type: "track-changed",
      trackType: "audio",
      id: 2,
      audioLanguageIntent: "ja",
    });
  },
);

testWithLua(
  "bridge do_cycle_audio aborts intent emission if same-URL file replacement occurs during cycle",
  async () => {
    const proc = Bun.spawn(["lua", "-", BRIDGE_PATH], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(String.raw`
local observers, keys, properties = {}, {}, {}
local tracks = { {id=1,type="audio",lang="en",selected=true}, {id=2,type="audio",lang="ja",selected=false} }
local playlist = { {id=1,filename="https://example.test/current.mkv",playing=true} }
local current_path = "https://example.test/current.mkv"
package.preload["mp.utils"] = function() return {format_json = function(v)
  return string.format('{"id":%d,"language":%q,"path":%q,"revision":%d}', v.id,v.language,v.path,v.revision)
end} end
local replace_during_cycle = false
local change_path_during_cycle = false
local unload_during_cycle = false
local replace_during_track_read = false
local track_reads = 0
mp = {
  create_osd_overlay=function() return {update=function() end,remove=function() end} end,
  observe_property=function(name,kind,callback) observers[name]=callback end,
  register_event=function() end,
  add_forced_key_binding=function(key,name,callback) keys[key]=callback end,
  add_key_binding=function() end,
  get_property_native=function(name,default)
    if name=="track-list" then
      track_reads = track_reads + 1
      if replace_during_track_read and track_reads > 1 then
        playlist = { {id=3,filename=current_path,playing=true} }
      end
      return tracks
    end
    if name=="playlist" then return playlist end
    return default
  end,
  get_property=function(name,default)
    if name=="path" then return current_path end
    return default
  end,
  set_property=function(name,value) properties[name]=value end,
  commandv=function(command,name)
    if command=="cycle" and name=="audio" then
      if replace_during_cycle then
        playlist = { {id=2,filename="https://example.test/current.mkv",playing=true} }
      end
      if change_path_during_cycle then
        current_path = "https://example.test/different.mkv"
      end
      if unload_during_cycle then
        current_path = ""
      end
      tracks[1].selected=false; tracks[2].selected=true
    end
  end,
}
dofile(arg[1])
replace_during_cycle = true
keys.a()
assert(properties["user-data/kunai-audio-intent"]==nil,"same-URL file replacement during cycle emitted intent")
replace_during_cycle = false

-- Path changed during cycle
change_path_during_cycle = true
tracks[1].selected=true; tracks[2].selected=false
keys.a()
assert(properties["user-data/kunai-audio-intent"]==nil,"path change during cycle emitted intent")
change_path_during_cycle = false

-- File unloaded during cycle
current_path = "https://example.test/current.mkv"
unload_during_cycle = true
tracks[1].selected=true; tracks[2].selected=false
keys.a()
assert(properties["user-data/kunai-audio-intent"]==nil,"unloaded file during cycle emitted intent")
unload_during_cycle = false

-- A replacement while reading the selected tracks must also fail closed.
current_path = "https://example.test/current.mkv"
playlist = { {id=2,filename=current_path,playing=true} }
tracks[1].selected=true; tracks[2].selected=false
track_reads = 0; replace_during_track_read = true
keys.a()
assert(properties["user-data/kunai-audio-intent"]==nil,"replacement during track read emitted intent")
replace_during_track_read = false

-- Now with stable path and playlist entry id 2, cycle should succeed
current_path = "https://example.test/current.mkv"
playlist = { {id=2,filename="https://example.test/current.mkv",playing=true} }
tracks[1].selected=true; tracks[2].selected=false
keys.a()
assert(properties["user-data/kunai-audio-intent"]~=nil,"stable cycle failed to emit intent")
`);
    proc.stdin.end();
    const [exitCode, _stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  },
);

test("audio intent parser rejects malformed or unattributed choices", async () => {
  const { parseMpvAudioIntent } = await import("@/infra/player/mpv-audio-intent");
  const path = "https://example.test/current.mkv";
  for (const payload of [
    null,
    [],
    "plain",
    { id: 0, language: "en", path },
    { id: 2, language: "und", path },
    { id: 2, language: "mul", path },
    { id: 2, language: "en", path: "https://example.test/old.mkv" },
    { id: 2, language: "English", path },
  ]) {
    expect(parseMpvAudioIntent(JSON.stringify(payload), path)).toBeNull();
  }
  expect(parseMpvAudioIntent("not json", path)).toBeNull();
  expect(parseMpvAudioIntent("x".repeat(8193), path)).toBeNull();
  expect(
    parseMpvAudioIntent(JSON.stringify({ id: 2, language: " PT_BR ", path }), path),
  ).toMatchObject({ audioLanguageIntent: "pt-br" });
});
