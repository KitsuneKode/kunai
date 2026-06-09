import { expect, test } from "bun:test";

import { forceSettleAllRootContent, mountRootContent } from "@/app-shell/root-content-state";

test("forceSettleAllRootContent resolves pending mount promises", async () => {
  const mounted = mountRootContent({
    kind: "playback",
    fallbackValue: "quit" as const,
    renderContent: () => null as never,
  });

  forceSettleAllRootContent("session-shutdown");
  await expect(mounted.result).resolves.toBe("quit");
});
