import { expect, test } from "bun:test";

import {
  clearRootContentSession,
  forceSettleAllRootContent,
  mountRootContent,
  subscribeRootContentSession,
} from "@/app-shell/root-content-state";

test("forceSettleAllRootContent resolves pending mount promises", async () => {
  const mounted = mountRootContent({
    kind: "playback",
    fallbackValue: "quit" as const,
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
    renderContent: () => null as never,
  });
  clearRootContentSession();
  mounted.close("cancelled");
  unsubscribe();

  expect(events).toEqual(["changed", "changed"]);
});
