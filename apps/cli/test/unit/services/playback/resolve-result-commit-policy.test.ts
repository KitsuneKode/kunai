import { describe, expect, test } from "bun:test";

import {
  cancellationReasonFromSignal,
  decideResolveResultCommit,
  type ResolveCancellationReason,
} from "@/services/playback/ResolveResultCommitPolicy";

describe("ResolveResultCommitPolicy", () => {
  test("persists a complete resolved inventory when resolve was not aborted", () => {
    expect(
      decideResolveResultCommit({
        hasResolvedStream: true,
        signalAborted: false,
      }),
    ).toEqual({ action: "persist-and-return", reason: "complete-active-result" });
  });

  test("adopts late valid inventory for user navigation without returning it into playback", () => {
    expect(
      decideResolveResultCommit({
        hasResolvedStream: true,
        signalAborted: true,
        cancellationReason: "user-navigation",
      }),
    ).toEqual({ action: "persist-only", reason: "late-valid-user-navigation" });
  });

  test.each([
    "user-shutdown",
    "provider-fallback",
    "superseded-prefetch",
    "timeout-budget",
    "network-offline",
  ] satisfies ResolveCancellationReason[])(
    "does not persist aborted results for %s",
    (cancellationReason) => {
      expect(
        decideResolveResultCommit({
          hasResolvedStream: true,
          signalAborted: true,
          cancellationReason,
        }),
      ).toEqual({ action: "discard", reason: `aborted:${cancellationReason}` });
    },
  );

  test("discards aborted results with no cancellation reason (Esc / unknown)", () => {
    expect(
      decideResolveResultCommit({
        hasResolvedStream: true,
        signalAborted: true,
      }),
    ).toEqual({ action: "discard", reason: "aborted:unknown" });
  });
});

describe("cancellationReasonFromSignal", () => {
  function abortedSignal(reason: unknown): AbortSignal {
    const controller = new AbortController();
    controller.abort(reason);
    return controller.signal;
  }

  test("returns undefined for a live signal", () => {
    expect(cancellationReasonFromSignal(new AbortController().signal)).toBeUndefined();
  });

  test.each([
    ["playback-loading-esc", "user-navigation"],
    ["user-requested", "user-navigation"],
    ["playback-loading-command-fallback", "provider-fallback"],
    ["shutdown", "user-shutdown"],
    ["app-exit", "user-shutdown"],
    ["resolve-deadline", "timeout-budget"],
    ["network-offline", "network-offline"],
    ["superseded-prefetch", "superseded-prefetch"],
  ] as const)("maps abort reason %s to %s", (raw, expected) => {
    expect(cancellationReasonFromSignal(abortedSignal(raw))).toBe(expected);
  });

  test("reads the reason from an AbortError message (fetch-safe abort path)", () => {
    const signal = abortedSignal(new DOMException("playback-loading-esc", "AbortError"));
    expect(cancellationReasonFromSignal(signal)).toBe("user-navigation");
  });

  test("returns undefined when the signal aborted without a usable reason", () => {
    const controller = new AbortController();
    controller.abort();
    expect(cancellationReasonFromSignal(controller.signal)).toBeUndefined();
  });
});
