import { expect, test } from "bun:test";

import {
  clearRootContentSession,
  forceSettleAllRootContent,
  getRootContentSession,
  mountRootContent,
  subscribeRootContentSession,
  waitForRootContentSlot,
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
  const browse = mountRootContent({
    kind: "browse",
    fallbackValue: "cancelled" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  const picker = mountRootContent({
    kind: "picker",
    fallbackValue: "dismissed" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  await expect(browse.result).resolves.toBe("cancelled");
  expect(getRootContentSession()?.kind).toBe("picker");

  picker.close("dismissed");
  await expect(picker.result).resolves.toBe("dismissed");
  expect(getRootContentSession()).toBeNull();
});

test("mountRootContent keeps a session mounted during its own subscriber notification", async () => {
  const first = mountRootContent({
    kind: "playback",
    fallbackValue: "quit" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  // Mounting B notifies subscribers synchronously; this subscriber mounts C in
  // response, which displaces B before B's own displacement-settle loop runs.
  // When B resumes, its loop must not evict C — it only owns the mount it
  // actually displaced (A).
  let nested: ReturnType<typeof mountRootContent<"dismissed">> | undefined;
  const unsubscribe = subscribeRootContentSession(() => {
    if (!nested && getRootContentSession()?.kind === "browse") {
      nested = mountRootContent({
        kind: "picker",
        fallbackValue: "dismissed" as const,
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        renderContent: () => null as never,
      });
    }
  });

  const second = mountRootContent<string>({
    kind: "browse",
    fallbackValue: "cancelled" as const,
    displacedValue: "displaced" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });
  unsubscribe();

  // C displaced B, so B resolves with its displaced marker — but C keeps the
  // slot it won instead of being swept by B's leftover settle pass.
  await expect(second.result).resolves.toBe("displaced");
  await expect(first.result).resolves.toBe("quit");
  expect(getRootContentSession()?.kind).toBe("picker");

  nested?.close("dismissed");
  await expect(nested?.result).resolves.toBe("dismissed");
  expect(getRootContentSession()).toBeNull();
});

test("waitForRootContentSlot parks while a foreign session owns the slot", async () => {
  const picker = mountRootContent({
    kind: "picker",
    fallbackValue: "dismissed" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  let released = false;
  const waiting = (async () => {
    await waitForRootContentSlot();
    released = true;
  })();
  // One microtask turn is enough: if the wait resolved immediately the
  // continuation above would already have run by the time we check.
  await Promise.resolve();
  expect(released).toBe(false);

  picker.close("dismissed");
  await waiting;
  expect(released).toBe(true);
});

test("waitForRootContentSlot resolves immediately while a browse session owns the slot", async () => {
  const browse = mountRootContent({
    kind: "browse",
    fallbackValue: "cancelled" as const,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    renderContent: () => null as never,
  });

  await expect(waitForRootContentSlot()).resolves.toBeUndefined();
  browse.close("cancelled");
});
