import { expect, test } from "bun:test";

import { shouldRecoverQueueOwner } from "@/domain/queue/queue-owner-recovery";
import type { QueueSessionRecord } from "@kunai/storage";

const session: QueueSessionRecord = {
  id: "sibling",
  status: "active",
  itemCount: 1,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
  ownerPid: 123,
  ownerHostname: "local",
  ownerProcessStartId: "original",
};
const input = {
  session,
  hostname: "local",
  now: Date.parse(session.updatedAt) + 2 * 60 * 60 * 1000,
  isAlive: () => true,
  processStartId: () => "original",
};

test("retains a verified live owner even after prolonged inactivity", () => {
  expect(shouldRecoverQueueOwner(input)).toBe(false);
});
test("recovers an abandoned queue after its PID has been reused", () => {
  expect(shouldRecoverQueueOwner({ ...input, processStartId: () => "successor" })).toBe(true);
});
test("recovers a dead local owner without a start-time probe", () => {
  expect(
    shouldRecoverQueueOwner({
      ...input,
      isAlive: () => false,
      processStartId: () => {
        throw new Error("must not probe");
      },
    }),
  ).toBe(true);
});
test("retains a foreign-host owner without probing its PID locally", () => {
  expect(
    shouldRecoverQueueOwner({
      ...input,
      hostname: "other",
      isAlive: () => {
        throw new Error("must not probe");
      },
    }),
  ).toBe(false);
});
test("does not turn an unavailable start-time probe into proof of a dead owner", () => {
  expect(shouldRecoverQueueOwner({ ...input, processStartId: () => null })).toBe(false);
});
test("legacy rows retain a live PID and otherwise require stale activity", () => {
  const legacy = { ...session, ownerHostname: undefined, ownerProcessStartId: undefined };
  expect(shouldRecoverQueueOwner({ ...input, session: legacy })).toBe(false);
  expect(shouldRecoverQueueOwner({ ...input, session: legacy, isAlive: () => false })).toBe(true);
  expect(
    shouldRecoverQueueOwner({
      ...input,
      session: { ...legacy, lastActivityAt: new Date(input.now).toISOString() },
      isAlive: () => false,
    }),
  ).toBe(false);
});
