import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  resolvedAddressBlockReason,
  setBlockedTargetDnsBudgetMsForTest,
} from "../src/blocked-target";

afterEach(() => {
  setBlockedTargetDnsBudgetMsForTest(4_000);
  mock.restore();
});

describe("resolvedAddressBlockReason", () => {
  test("an aborted caller signal returns null without consulting DNS", async () => {
    // The lookup is skipped entirely on a dead signal — a cancelled probe must
    // not sit on a resolver round-trip.
    const result = await resolvedAddressBlockReason(
      "https://definitely-not-a-real-host.invalid/",
      AbortSignal.abort(),
    );
    expect(result).toBeNull();
  });

  test("a DNS lookup that never answers is bounded by the budget", async () => {
    // A resolver that accepts the query and never answers used to pend past
    // every caller deadline. Mock it hanging and prove the cap releases the
    // call with "no answers" — the fetch then fails on its own.
    mock.module("node:dns/promises", () => ({
      lookup: () => new Promise(() => {}),
    }));
    setBlockedTargetDnsBudgetMsForTest(15);

    const started = Date.now();
    const result = await resolvedAddressBlockReason("https://example.com/");
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test("private DNS answers are blocked with the host named", async () => {
    mock.module("node:dns/promises", () => ({
      lookup: () => Promise.resolve([{ address: "10.0.0.4", family: 4 }]),
    }));
    const result = await resolvedAddressBlockReason("https://example.com/");
    expect(result).toContain("DNS answer for example.com");
  });
});
