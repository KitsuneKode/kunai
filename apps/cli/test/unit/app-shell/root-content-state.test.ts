import { expect, test } from "bun:test";

import {
  clearRootContentSession,
  forceCloseRootContent,
  forceSettleAllRootContent,
  mountRootContent,
  subscribeRootContentSession,
} from "@/app-shell/root-content-state";

test("forceSettleAllRootContent resolves pending mount promises", async () => {
  const mounted = mountRootContent({
    kind: "playback",
    fallbackValue: "quit" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  forceSettleAllRootContent("session-shutdown");
  await expect(mounted.result).resolves.toBe("quit");
});

test("subscribeRootContentSession notifies on mount and clear", () => {
  const events: string[] = [];
  const unsubscribe = subscribeRootContentSession(() => events.push("changed"));

  const mounted = mountRootContent({
    kind: "picker",
    fallbackValue: "cancelled" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });
  clearRootContentSession();
  mounted.close("cancelled");
  unsubscribe();

  expect(events).toEqual(["changed", "changed"]);
});

test("mountRootContent settles a displaced session with its fallback", async () => {
  const first = mountRootContent({
    kind: "browse",
    fallbackValue: "cancelled" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });
  const second = mountRootContent({
    kind: "picker",
    fallbackValue: "picker-done" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  // Without the displaced settle the first mount promise would hang until teardown.
  await expect(first.result).resolves.toBe("cancelled");
  second.close("picker-done");
  await expect(second.result).resolves.toBe("picker-done");
});

test("forceCloseRootContent refuses to settle an incompatible kind", async () => {
  const mounted = mountRootContent({
    kind: "picker",
    fallbackValue: "cancelled" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  const delivered = forceCloseRootContent("launch-playback", {
    kinds: ["browse", "post-playback"],
  });
  expect(delivered).toBe(false);

  mounted.close("cancelled");
  await expect(mounted.result).resolves.toBe("cancelled");
});

test("forceCloseRootContent settles a compatible kind", async () => {
  const mounted = mountRootContent({
    kind: "browse",
    fallbackValue: "cancelled" as "cancelled" | "launch-playback",
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  const delivered = forceCloseRootContent("launch-playback", {
    kinds: ["browse", "post-playback"],
  });
  expect(delivered).toBe(true);
  await expect(mounted.result).resolves.toBe("launch-playback");
});
