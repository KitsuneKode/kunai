import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  isPrivateLiteralAddress,
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

describe("isPrivateLiteralAddress documentation ranges", () => {
  // IANA pins documentation ranges at /24 granularity; a wider block would
  // reject ordinary routable space as "private" and drop legitimate targets.
  test("only the /24 documentation ranges are blocked", () => {
    for (const blocked of [
      "192.0.2.10", // TEST-NET-1
      "198.51.100.10", // TEST-NET-2
      "203.0.113.10", // TEST-NET-3
    ]) {
      expect(isPrivateLiteralAddress(blocked)).not.toBeNull();
    }
    for (const routable of [
      "192.0.3.10",
      "198.51.99.10",
      "198.51.101.10",
      "203.0.0.10",
      "203.0.114.10",
    ]) {
      expect(isPrivateLiteralAddress(routable)).toBeNull();
    }
  });

  test("other special-use ranges stay blocked", () => {
    for (const blocked of [
      "10.9.9.9",
      "127.5.4.3",
      "169.254.1.2",
      "172.31.255.255",
      "192.168.4.4",
      "192.0.0.9", // 192.0.0.0/24 protocol assignments
      "198.18.64.1", // benchmarking
      "224.0.0.1", // multicast
      "255.255.255.255", // broadcast
      "100.64.0.1", // CGNAT floor
      "100.127.255.254", // CGNAT ceiling
    ]) {
      expect(isPrivateLiteralAddress(blocked)).not.toBeNull();
    }
  });
});
