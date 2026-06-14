import { describe, expect, it } from "bun:test";

import { createInitialState, reduceState } from "@/domain/session/SessionState";

function initial() {
  return createInitialState("vidking", "allanime", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "none" },
    movie: { audio: "original", subtitle: "en" },
  });
}

describe("SET_AUTO_NEXT_COUNTDOWN", () => {
  it("sets and clears the auto-next countdown", () => {
    let state = reduceState(initial(), { type: "SET_AUTO_NEXT_COUNTDOWN", seconds: 3 });
    expect(state.autoNextCountdownSeconds).toBe(3);
    state = reduceState(state, { type: "SET_AUTO_NEXT_COUNTDOWN", seconds: null });
    expect(state.autoNextCountdownSeconds).toBeNull();
  });
});
