import { expect, test } from "bun:test";

import {
  INITIAL_NAV_INTERACTION,
  isNavCompact,
  reduceNavInteraction,
} from "../lib/nav-interaction";

test("hover expands after scrolling, another scroll compacts, and re-entry expands again", () => {
  let state = INITIAL_NAV_INTERACTION;
  expect(isNavCompact(state)).toBe(false);
  state = reduceNavInteraction(state, { type: "scroll-position", scrolled: true });
  expect(isNavCompact(state)).toBe(true);
  state = reduceNavInteraction(state, { type: "hover", hovered: true });
  expect(isNavCompact(state)).toBe(false);
  state = reduceNavInteraction(state, { type: "scroll" });
  expect(isNavCompact(state)).toBe(true);
  state = reduceNavInteraction(state, { type: "hover", hovered: true });
  expect(isNavCompact(state)).toBe(false);
  state = reduceNavInteraction(state, { type: "hover", hovered: false });
  expect(isNavCompact(state)).toBe(true);
});

test("scroll and pointer departure never remove focused destinations", () => {
  let state = reduceNavInteraction(INITIAL_NAV_INTERACTION, {
    type: "scroll-position",
    scrolled: true,
  });
  state = reduceNavInteraction(state, { type: "focus", focused: true });
  state = reduceNavInteraction(state, { type: "scroll" });
  state = reduceNavInteraction(state, { type: "hover", hovered: false });
  expect(isNavCompact(state)).toBe(false);
  state = reduceNavInteraction(state, { type: "focus", focused: false });
  expect(isNavCompact(state)).toBe(true);
  state = reduceNavInteraction(state, { type: "scroll-position", scrolled: false });
  expect(isNavCompact(state)).toBe(false);
});
