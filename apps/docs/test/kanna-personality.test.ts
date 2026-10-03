import { describe, expect, test } from "bun:test";

import { commandForKey, type KeyPress, type KeyTarget } from "../lib/kanna-controls";
import {
  CALM,
  DECAY_MS,
  GRUMPY_AT,
  isStubborn,
  linesFor,
  MAX_ANNOYANCE,
  moodOf,
  react,
  settle,
  STUBBORN_MS,
  SULKING_AT,
  SULKING_MUTTERS,
  tipFor,
  type KannaEvent,
  type MoodState,
} from "../lib/kanna-mood";
import {
  fromPlace,
  parsePlace,
  PERCH_INSET_PX,
  PLACE_KEY,
  seedFor,
  toPlace,
} from "../lib/kanna-place";

const T0 = 1_000_000;

/** Push her around `times` times in the same instant, returning the state she ends in. */
function push(times: number, event: KannaEvent = "picked-up", at = T0): MoodState {
  let state: MoodState = CALM;
  for (let index = 0; index < times; index += 1) state = react(state, event, at).state;
  return state;
}

describe("her mood", () => {
  test("starts content and stays content for a nudge or two", () => {
    expect(moodOf(CALM, T0)).toBe("content");
    expect(moodOf(push(1), T0)).toBe("content");
    expect(moodOf(push(2), T0)).toBe("content");
  });

  test("turns grumpy, then sulking, as she is pushed around", () => {
    expect(moodOf(push(GRUMPY_AT), T0)).toBe("grumpy");
    expect(moodOf(push(SULKING_AT), T0)).toBe("sulking");
  });

  test("being carried and being told to stay both count; being called and napping do not", () => {
    expect(react(CALM, "picked-up", T0).state.annoyance).toBe(1);
    expect(react(CALM, "stay", T0).state.annoyance).toBe(1);
    expect(react(CALM, "come", T0).state.annoyance).toBe(0);
    expect(react(CALM, "nap", T0).state.annoyance).toBe(0);
    expect(react(CALM, "placed", T0).state.annoyance).toBe(0);
  });

  test("a poke is a small annoyance, so a few are tolerated", () => {
    expect(react(CALM, "poked", T0).state.annoyance).toBe(0.25);
    expect(moodOf(push(4, "poked"), T0)).toBe("content");
  });

  test("it wears off with time, a point a minute", () => {
    const sulking = push(SULKING_AT);
    expect(moodOf(sulking, T0)).toBe("sulking");
    // Five points down by one and a half minutes is 3.5: still short with you.
    expect(moodOf(sulking, T0 + DECAY_MS * 1.5)).toBe("grumpy");
    // And by two and a half it is 2.5, under the grumpy line.
    expect(moodOf(sulking, T0 + DECAY_MS * 2.5)).toBe("content");
    expect(moodOf(sulking, T0 + DECAY_MS * SULKING_AT)).toBe("content");
  });

  test("it cannot go below nothing, or above the ceiling", () => {
    expect(settle(CALM, T0 + DECAY_MS * 10).annoyance).toBe(0);
    expect(push(50).annoyance).toBe(MAX_ANNOYANCE);
  });

  test("settling does not move time backwards", () => {
    const state = push(2, "picked-up", T0);
    expect(settle(state, T0 - 5_000)).toBe(state);
  });
});

describe("being stubborn", () => {
  test("she starts refusing calls the moment she tips into sulking", () => {
    const sulking = push(SULKING_AT);
    expect(isStubborn(sulking, T0)).toBe(true);
    expect(sulking.stubbornUntil).toBe(T0 + STUBBORN_MS);
  });

  test("a call while she is stubborn is refused, and does not annoy her further", () => {
    const sulking = push(SULKING_AT);
    const asked = react(sulking, "come", T0 + 1_000);
    expect(asked.outcome).toBe("refused");
    expect(asked.state.annoyance).toBeLessThanOrEqual(sulking.annoyance);
  });

  test("it is short: after the spell she answers again", () => {
    const sulking = push(SULKING_AT);
    const later = react(sulking, "come", T0 + STUBBORN_MS + 1);
    expect(later.outcome).toBe("ok");
    expect(isStubborn(later.state, T0 + STUBBORN_MS + 1)).toBe(false);
  });

  test("pushing her more while she sulks does not extend the spell", () => {
    const sulking = push(SULKING_AT);
    const pushedAgain = react(sulking, "picked-up", T0 + 10_000).state;
    expect(pushedAgain.stubbornUntil).toBe(sulking.stubbornUntil);
  });

  test("a calm fox is never stubborn: calling her always works", () => {
    expect(react(CALM, "come", T0).outcome).toBe("ok");
  });
});

describe("what she says", () => {
  const events: KannaEvent[] = ["picked-up", "placed", "stay", "come", "nap", "poked"];
  const moods = ["content", "grumpy", "sulking"] as const;

  test("has something to say for every event in every mood", () => {
    for (const event of events) {
      for (const mood of moods) expect(linesFor(event, mood).length).toBeGreaterThan(0);
    }
    for (const mood of moods) expect(linesFor("come", mood, "refused").length).toBeGreaterThan(0);
  });

  test("a refused call is a different line from an answered one", () => {
    const answered = linesFor("come", "sulking", "ok");
    const refused = linesFor("come", "sulking", "refused");
    expect(refused).not.toEqual(answered);
  });

  test("every line is short and lower case, in her voice", () => {
    const all = [
      ...events.flatMap((event) => moods.flatMap((mood) => linesFor(event, mood))),
      ...moods.flatMap((mood) => linesFor("come", mood, "refused")),
      ...SULKING_MUTTERS,
    ];
    for (const line of all) {
      expect(line.length).toBeLessThanOrEqual(48);
      expect(line).toBe(line.toLowerCase());
    }
  });

  test("the grumbling is about being managed, never about the reader", () => {
    const all = events.flatMap((event) => moods.flatMap((mood) => linesFor(event, mood)));
    for (const line of all) expect(line).not.toMatch(/\b(stupid|idiot|ugly|dumb|loser)\b/i);
  });

  test("the tip points at the controls that exist for the device", () => {
    expect(tipFor(true)).toContain("s makes me stay");
    expect(tipFor(true)).toContain("c calls me");
    expect(tipFor(false)).not.toContain("s makes me stay");
    expect(tipFor(false)).toContain("carry me");
  });
});

describe("the keys", () => {
  const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...extra,
  });
  const body: KeyTarget = { tagName: "BODY", isContentEditable: false, inDialog: false };

  test("s stays, c comes, n naps", () => {
    expect(commandForKey(press("s"), body)).toBe("stay");
    expect(commandForKey(press("c"), body)).toBe("come");
    expect(commandForKey(press("n"), body)).toBe("nap");
  });

  test("any other key is left alone", () => {
    for (const key of ["a", "k", "/", "Escape", "Enter", "1"]) {
      expect(commandForKey(press(key), body)).toBeNull();
    }
  });

  test("a chord is a shortcut for something else: Ctrl+C is copy, Cmd+S is save", () => {
    expect(commandForKey(press("c", { ctrlKey: true }), body)).toBeNull();
    expect(commandForKey(press("s", { metaKey: true }), body)).toBeNull();
    expect(commandForKey(press("n", { altKey: true }), body)).toBeNull();
  });

  test("a capital is typing, not a command", () => {
    expect(commandForKey(press("S", { shiftKey: true }), body)).toBeNull();
    expect(commandForKey(press("C"), body)).toBeNull();
  });

  test("never takes a key from someone who is typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      expect(
        commandForKey(press("s"), { tagName, isContentEditable: false, inDialog: false }),
      ).toBeNull();
    }
    expect(
      commandForKey(press("s"), { tagName: "DIV", isContentEditable: true, inDialog: false }),
    ).toBeNull();
  });

  test("never acts while a dialog such as search is open", () => {
    expect(
      commandForKey(press("n"), { tagName: "DIV", isContentEditable: false, inDialog: true }),
    ).toBeNull();
  });

  test("a held key does not repeat the command", () => {
    expect(commandForKey(press("s", { repeat: true }), body)).toBeNull();
  });

  test("with no focused element at all, the key still works", () => {
    expect(commandForKey(press("s"), null)).toBe("stay");
  });
});

describe("where she was left", () => {
  const view = { width: 1000, height: 800 };

  test("round-trips a spot as a share of the window", () => {
    const place = toPlace({ x: 250, y: 600 }, view);
    expect(place).toEqual({ fx: 0.25, fy: 0.75 });
    expect(fromPlace(place, view, 20)).toEqual({ x: 250, y: 600 });
  });

  test("a spot chosen on a wide window is still on screen on a narrow one", () => {
    const place = toPlace({ x: 950, y: 780 }, view);
    const onPhone = fromPlace(place, { width: 390, height: 780 }, 24);
    expect(onPhone.x).toBeLessThanOrEqual(390 - 24);
    expect(onPhone.y).toBeLessThanOrEqual(780 - 24);
  });

  test("is kept inside the window by the margin, never half off the edge", () => {
    expect(fromPlace({ fx: 0, fy: 0 }, view, 30)).toEqual({ x: 30, y: 30 });
    expect(fromPlace({ fx: 1, fy: 1 }, view, 30)).toEqual({ x: 970, y: 770 });
  });

  test("reads back what was stored", () => {
    expect(parsePlace(JSON.stringify({ fx: 0.4, fy: 0.9 }))).toEqual({ fx: 0.4, fy: 0.9 });
  });

  test("ignores anything that is not exactly a place: the store can be edited by anyone", () => {
    for (const stored of [
      null,
      "",
      "not json",
      "{}",
      JSON.stringify({ fx: 0.5 }),
      JSON.stringify({ fx: 2, fy: 0.5 }),
      JSON.stringify({ fx: -1, fy: 0.5 }),
      JSON.stringify({ fx: "0.5", fy: 0.5 }),
      JSON.stringify({ fx: null, fy: 0.5 }),
      "[1,2]",
      "null",
    ]) {
      expect(parsePlace(stored)).toBeNull();
    }
  });

  test("an empty window falls back to the middle instead of dividing by zero", () => {
    expect(toPlace({ x: 10, y: 10 }, { width: 0, height: 0 })).toEqual({ fx: 0.5, fy: 0.5 });
  });

  test("uses a key that cannot collide with the dismissal flag", () => {
    expect(PLACE_KEY).toBe("kunai.roamer.place");
    expect(PLACE_KEY).not.toBe("kunai.roamer.dismissed");
  });
});

describe("where she starts", () => {
  const view = { width: 1000, height: 800 };
  const saved = { fx: 0.25, fy: 0.5 };

  test("a remembered place wins on any device, because someone chose it", () => {
    for (const perched of [true, false]) {
      expect(seedFor({ perched, saved, view, margin: 33 })).toEqual({
        at: { x: 250, y: 400 },
        phase: "sitting",
      });
    }
  });

  test("on a touch screen with nothing remembered she perches bottom-left, asleep", () => {
    expect(seedFor({ perched: true, saved: null, view, margin: 33 })).toEqual({
      at: { x: PERCH_INSET_PX, y: 800 - PERCH_INSET_PX },
      phase: "asleep",
    });
  });

  test("with a mouse and nothing remembered she has no seed: she waits for the pointer", () => {
    expect(seedFor({ perched: false, saved: null, view, margin: 33 })).toBeNull();
  });

  test("a remembered place is pulled inside a window that has since shrunk", () => {
    const seed = seedFor({
      perched: false,
      saved: { fx: 1, fy: 1 },
      view: { width: 390, height: 700 },
      margin: 33,
    });
    expect(seed?.at).toEqual({ x: 357, y: 667 });
  });

  test("the perch stays on screen even in a very short window", () => {
    const seed = seedFor({
      perched: true,
      saved: null,
      view: { width: 300, height: 20 },
      margin: 33,
    });
    expect(seed?.at.y).toBeGreaterThanOrEqual(PERCH_INSET_PX);
  });
});
