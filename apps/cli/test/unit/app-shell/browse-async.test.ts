import { expect, test } from "bun:test";

import { createLatestRequestGate, runBrowseMutation } from "@/app-shell/browse-async";

test("latest request gate rejects a completed older request", () => {
  const gate = createLatestRequestGate();
  const first = gate.begin();
  const second = gate.begin();

  expect(gate.isCurrent(first)).toBe(false);
  expect(gate.isCurrent(second)).toBe(true);

  gate.invalidate();

  expect(gate.isCurrent(second)).toBe(false);
});

test("browse mutation turns a rejection into safe feedback", async () => {
  const result = await runBrowseMutation(async () => {
    throw new Error("database unavailable");
  });

  expect(result).toEqual({ ok: false, message: "database unavailable" });
});

test("browse mutation contains synchronous callback errors", async () => {
  const result = await runBrowseMutation(() => {
    throw new Error("storage unavailable");
  });

  expect(result).toEqual({ ok: false, message: "storage unavailable" });
});
