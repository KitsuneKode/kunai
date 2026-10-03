import { expect, mock, test } from "bun:test";
let lookupFails = false;
const targets: string[] = [];
mock.module("node:dns/promises", () => ({ lookup: async () => {
  if (lookupFails) throw new Error("controlled DNS failure");
  return [{ address: "8.8.8.8", family: 4 }];
}}));
globalThis.fetch = mock(async (target) => {
  targets.push(String(target));
  return new Response("ok");
});
const { fetchGuardedRemoteTarget } = await import("@/infra/net/guarded-remote-fetch");
test("the connection must use the address checked during DNS preflight", async () => {
  await fetchGuardedRemoteTarget("https://cdn.example.test/path");
  expect(new URL(targets.at(-1)!).hostname).toBe("8.8.8.8");
});
test("DNS failure must not permit an unchecked fetch", async () => {
  lookupFails = true;
  const before = targets.length;
  await expect(fetchGuardedRemoteTarget("https://cdn.example.test/path")).rejects.toThrow();
  expect(targets.length).toBe(before);
});
