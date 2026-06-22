import { expect, test } from "bun:test";

import { resolveKeybinding, resolveShellInputCommand } from "@/app-shell/keybinding-runtime";

test("resolveKeybinding checks global bindings before the active surface", () => {
  expect(resolveKeybinding(["player"], "/", {})?.id).toBe("command-palette");
  expect(resolveKeybinding(["player"], "c", { ctrl: true })?.id).toBe("quit");
});

test("resolveKeybinding skips help-only bindings", () => {
  expect(resolveKeybinding(["browse"], "", { downArrow: true })).toBeNull();
});

test("resolveShellInputCommand maps registry bindings to input-router commands", () => {
  expect(resolveShellInputCommand(["browse"], "/", {})).toBe("open-command-palette");
  expect(resolveShellInputCommand(["browse"], "c", { ctrl: true })).toBe("quit");
  expect(resolveShellInputCommand(["browse"], "x", {})).toBeNull();
});
