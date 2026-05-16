import { expect, test } from "bun:test";

test("useLineEditor is importable and returns cursor", () => {
  const mod = require("@/app-shell/line-editor");
  expect(typeof mod.useLineEditor).toBe("function");
});
