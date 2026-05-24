import { describe, expect, test } from "bun:test";

import { decideProviderHealthWrite } from "@/services/playback/ProviderHealthEvidence";

describe("decideProviderHealthWrite", () => {
  test("records provider-scoped failure evidence that can inform local routing", () => {
    expect(
      decideProviderHealthWrite({
        errorClass: "dead-stream",
        sourceId: "source:kiwi",
        serverId: "kiwi",
        networkConfidence: "healthy",
      }),
    ).toEqual({
      action: "record-failure",
      evidence: {
        errorClass: "dead-stream",
        sourceId: "source:kiwi",
        serverId: "kiwi",
        networkConfidence: "healthy",
      },
    });
  });

  test("does not poison provider health for network, cancellation, or diagnostic evidence", () => {
    expect(decideProviderHealthWrite({ errorClass: "network-offline" })).toEqual({
      action: "skip",
      reason: "network-offline",
    });
    expect(decideProviderHealthWrite({ errorClass: "network-limited" })).toEqual({
      action: "skip",
      reason: "network-limited",
    });
    expect(decideProviderHealthWrite({ errorClass: "cancelled" })).toEqual({
      action: "skip",
      reason: "cancelled",
    });
    expect(decideProviderHealthWrite({ errorClass: "manual-diagnostic" })).toEqual({
      action: "skip",
      reason: "manual-diagnostic",
    });
  });
});
