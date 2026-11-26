import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KEYBINDINGS } from "@/app-shell/keybindings";

/**
 * The mpv window and `?` help share one key map (Neon features review #9): the
 * bridge used to bind s/S to the source picker, a/d to audio cycling and v/V
 * to quality while help said reload subtitles, autoplay, diagnostics — and v
 * is mpv's own subtitle toggle. Every key the bridge binds must mean what the
 * `player`-scope binding with that chord means.
 */
const lua = readFileSync(join(import.meta.dir, "../../../assets/mpv/kunai-bridge.lua"), "utf8");

/** Bridge binding names whose verb maps onto a help binding id. */
const VERB_BINDINGS = new Map<string, string>([
  ["kunai-next", "player-next"],
  ["kunai-next-shift", "player-next"],
  ["kunai-prev", "player-previous"],
  ["kunai-prev-shift", "player-previous"],
  ["kunai-skip", "player-skip"],
  ["kunai-quality", "player-quality"],
  ["kunai-quality-shift", "player-quality"],
  ["kunai-source", "player-source"],
  ["kunai-cycle-source", "player-cycle-source"],
  ["kunai-cycle-source-shift", "player-cycle-source"],
  ["kunai-cycle-audio", "player-cycle-audio"],
  ["kunai-refresh", "player-refresh"],
  ["kunai-resume-seek", "player-resume-seek"],
  ["kunai-copy-share", "player-share-moment"],
  ["kunai-quality-alt", "player-quality"],
  ["kunai-quality-alt-shift", "player-quality"],
  ["kunai-source-shift", "player-source"],
  ["kunai-cycle-audio-shift", "player-cycle-audio"],
  ["kunai-cycle-audio-alt", "player-cycle-audio"],
  ["kunai-cycle-audio-alt-shift", "player-cycle-audio"],
]);

function bridgeKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  // Top-level bindings only: the resume prompt and skip chip rebind briefly.
  for (const match of lua.matchAll(/^mp\.add_(?:forced_)?key_binding\("([^"]+)", "([^"]+)"/gm)) {
    const [, key, name] = match;
    const id = name ? VERB_BINDINGS.get(name) : undefined;
    if (key && id) keys.set(key, id);
  }
  for (const match of lua.matchAll(/\{ "([^"]+)", "([a-z-]+)" \}/g)) {
    const [, key, id] = match;
    if (key && id) keys.set(key, id);
  }
  return keys;
}

const PLAYER = KEYBINDINGS.filter((binding) => binding.scope === "player");

/** The bridge's spelling of a help binding's chord (mpv key names). */
function mpvKeyFor(id: string): string | undefined {
  const binding = PLAYER.find((candidate) => candidate.id === id);
  const input = binding?.chord.input;
  if (!binding || !input) return undefined;
  const { ctrl, meta, shift } = binding.chord;
  if (ctrl && shift) return `ctrl+shift+${input.toLowerCase()}`;
  if (ctrl) return `ctrl+${input}`;
  if (meta) return `alt+${input}`;
  return input;
}

/** Shift aliases (N for n) are fine only while help gives the capital no meaning of its own. */
function isFreeShiftAlias(key: string, chord: string): boolean {
  return (
    key.length === 1 &&
    key === chord.toUpperCase() &&
    key !== chord &&
    !PLAYER.some((binding) => binding.chord.input === key)
  );
}

describe("mpv bridge keys match ? help", () => {
  test("every bridge key is the help binding with that chord", () => {
    const keys = bridgeKeys();
    expect(keys.size).toBeGreaterThan(15);
    for (const [key, id] of keys) {
      const chord = mpvKeyFor(id);
      expect(chord, `${key} → ${id} has no player-scope help entry`).toBeDefined();
      if (!chord) continue;
      const bound = key.length === 1 ? key : key.toLowerCase();
      expect(
        bound === chord || isFreeShiftAlias(bound, chord),
        `${key} → ${id} (help: ${chord})`,
      ).toBe(true);
    }
  });

  test("help keys the bridge cannot service by verb are sent as key:<id>", () => {
    const keys = bridgeKeys();
    for (const id of [
      "player-reload-subtitles",
      "player-return-search",
      "player-autoplay",
      "player-autoskip",
      "player-stop-after-current",
      "player-episode",
      "player-fallback",
      "player-diagnostics",
    ]) {
      expect([...keys.values()], id).toContain(id);
    }
  });

  test("mpv's own v (subtitle visibility) is left alone", () => {
    expect(bridgeKeys().has("v")).toBe(false);
    expect(bridgeKeys().has("V")).toBe(false);
  });
});
