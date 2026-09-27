import { expect, test } from "bun:test";
import { resolve } from "node:path";

// An untrusted `kunai://` handoff must never produce provider network I/O
// before the local confirmation. `resolveShareTarget` can issue provider
// searches while mapping anime catalog anchors, so the confirmation prompt has
// to run before `applyShareRefLaunch` — not after it, where a smuggled link
// could make the app emit catalog ids to providers without consent.
test("untrusted protocol handoffs confirm before share resolution runs", async () => {
  const source = await Bun.file(resolve(import.meta.dir, "../../../src/main.ts")).text();

  const confirmAt = source.indexOf("confirmProtocolHandoff(protocolHandoff)");
  const resolveAt = source.indexOf("applyShareRefLaunch(");

  expect(confirmAt).toBeGreaterThan(-1);
  expect(resolveAt).toBeGreaterThan(-1);
  expect(confirmAt).toBeLessThan(resolveAt);
});
