import { expect, test } from "bun:test";

import {
  routeShellInput,
  routeOverlayInput,
  resolveSurfaceTitleControlInput,
} from "@/app-shell/input-router";

test("ctrl-c always routes to the hard global owner", () => {
  expect(
    routeShellInput("c", { ctrl: true }, { commandPaletteOpen: true, modalOpen: true }),
  ).toEqual({
    owner: "hard-global",
    command: "quit",
  });
});

test("command palette owns input before modal and surface shortcuts", () => {
  expect(routeShellInput("/", {}, { commandPaletteOpen: true, modalOpen: true })).toEqual({
    owner: "command-palette",
    command: null,
  });
});

test("modal owns slash when command palette is closed", () => {
  expect(routeShellInput("/", {}, { modalOpen: true })).toEqual({
    owner: "modal",
    command: null,
  });
});

test("picker filter keeps slash inside the modal owner", () => {
  expect(routeShellInput("/", {}, { modalOpen: true, textInputFocused: true })).toEqual({
    owner: "modal",
    command: null,
  });
});

test("search input can request command palette without swallowing slash locally", () => {
  expect(routeShellInput("/", {}, { textInputFocused: true })).toEqual({
    owner: "text-input",
    command: "open-command-palette",
  });
});

test("playback surface slash opens command palette", () => {
  expect(routeShellInput("/", {}, {})).toEqual({
    owner: "surface",
    command: "open-command-palette",
  });
});

test("overlay route maps escape to close", () => {
  expect(routeOverlayInput("", { escape: true }, { overlayOpen: true })).toEqual({
    owner: "overlay",
    command: "close",
  });
});

test("overlay route maps bracket chords to page navigation", () => {
  expect(routeOverlayInput("[", {}, { overlayOpen: true })).toEqual({
    owner: "overlay",
    command: "page-up",
  });
  expect(routeOverlayInput("]", {}, { overlayOpen: true })).toEqual({
    owner: "overlay",
    command: "page-down",
  });
});

test("title-control m routes on loading surface outside text input", () => {
  expect(
    resolveSurfaceTitleControlInput("m", {}, { scope: "loading", textInputFocused: false }),
  ).toEqual({ kind: "title-control-menu" });
});

test("title-control e routes episode picker on player surface", () => {
  expect(resolveSurfaceTitleControlInput("e", {}, { scope: "player" })).toEqual({
    kind: "pick-episode",
  });
});

test("title-control never swallows esc or slash", () => {
  expect(resolveSurfaceTitleControlInput("", { escape: true }, { scope: "player" })).toBeNull();
  expect(resolveSurfaceTitleControlInput("/", {}, { scope: "loading" })).toBeNull();
});

test("browse title-control m requires list-ready context", () => {
  expect(
    resolveSurfaceTitleControlInput("m", {}, { scope: "browse", browseListReady: false }),
  ).toBeNull();
  expect(
    resolveSurfaceTitleControlInput("m", {}, { scope: "browse", browseListReady: true }),
  ).toEqual({ kind: "title-control-menu" });
});
