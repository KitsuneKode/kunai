import { describe, expect, test } from "bun:test";

import {
  connectedConnection,
  disconnectedConnection,
  needsReauthConnection,
  syncCancelled,
  syncFailed,
  syncNeedsReauth,
  syncOk,
  syncSkipped,
} from "@/services/sync/types";

/**
 * The outbox decides a row's fate from the outcome alone — complete, retry,
 * release, require reauth, or dead-letter. So `retryable` must be derived from
 * the failure kind rather than set by each call site: a mapping failure marked
 * retryable would be redelivered forever, and a network failure marked
 * non-retryable would be dead-lettered on one flaky request.
 */
describe("sync outcome constructors", () => {
  test("network and remote failures are retryable", () => {
    expect(syncFailed("request-timeout", "network")).toEqual({
      status: "failed",
      code: "request-timeout",
      kind: "network",
      retryable: true,
    });
    expect(syncFailed("remote-503", "remote")).toEqual({
      status: "failed",
      code: "remote-503",
      kind: "remote",
      retryable: true,
    });
  });

  test("mapping and invalid failures are not retryable", () => {
    expect(syncFailed("tracker-target-mismatch", "mapping")).toEqual({
      status: "failed",
      code: "tracker-target-mismatch",
      kind: "mapping",
      retryable: false,
    });
    expect(syncFailed("capability-unsupported", "invalid")).toEqual({
      status: "failed",
      code: "capability-unsupported",
      kind: "invalid",
      retryable: false,
    });
  });

  test("carries an optional detail without inventing the key", () => {
    expect(syncFailed("remote-500", "remote", "upstream")).toEqual({
      status: "failed",
      code: "remote-500",
      kind: "remote",
      retryable: true,
      detail: "upstream",
    });
    expect(syncOk()).toEqual({ status: "ok" });
    expect(syncOk("already-current")).toEqual({ status: "ok", detail: "already-current" });
  });

  /**
   * Cancellation is not failure. A shutdown mid-request must release the claim
   * with attempts unchanged, so an orderly quit cannot walk a row toward the
   * dead-letter state.
   */
  test("distinguishes cancellation from failure", () => {
    expect(syncCancelled("shutdown")).toEqual({ status: "cancelled", reason: "shutdown" });
    expect(syncCancelled("caller-aborted")).toEqual({
      status: "cancelled",
      reason: "caller-aborted",
    });
  });

  test("models a structural skip and a reauth demand", () => {
    expect(syncSkipped("tracker-disabled")).toEqual({
      status: "skipped",
      reason: "tracker-disabled",
    });
    expect(syncNeedsReauth("token-rejected")).toEqual({
      status: "needs-reauth",
      code: "token-rejected",
    });
  });
});

describe("connection state constructors", () => {
  test("models disconnected, connected and needs-reauth", () => {
    expect(disconnectedConnection()).toEqual({ state: "disconnected" });
    expect(connectedConnection("kitsune")).toEqual({ state: "connected", username: "kitsune" });
    expect(connectedConnection("kitsune", "2026-09-01T00:00:00.000Z")).toEqual({
      state: "connected",
      username: "kitsune",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    expect(needsReauthConnection("token-expired")).toEqual({
      state: "needs-reauth",
      reason: "token-expired",
    });
  });

  /** Absent optionals stay absent rather than becoming `undefined` keys. */
  test("omits unknown identity rather than serialising undefined", () => {
    expect(connectedConnection()).toEqual({ state: "connected" });
    expect(Object.keys(connectedConnection())).toEqual(["state"]);
  });
});
