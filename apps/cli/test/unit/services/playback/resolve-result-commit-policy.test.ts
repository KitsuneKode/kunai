import { describe, expect, test } from "bun:test";

import {
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
});
