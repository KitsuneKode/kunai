import { describe, expect, it } from "bun:test";

import type { EndpointHealthFailureInfo, ProviderId } from "@kunai/types";

import {
  guardEndpointHealthAgainstCancellation,
  isCancellationAbort,
  ProviderAttemptTimeoutError,
} from "../src/provider-attempt-cancellation";

type RecordedFailure = {
  readonly providerId: ProviderId;
  readonly endpoint: string;
  readonly info: EndpointHealthFailureInfo;
};

function createRecordingPort() {
  const failures: RecordedFailure[] = [];
  const successes: string[] = [];
  return {
    failures,
    successes,
    port: {
      shouldTry: () => true,
      recordSuccess: (_providerId: ProviderId, endpoint: string) => {
        successes.push(endpoint);
      },
      recordFailure: (
        providerId: ProviderId,
        endpoint: string,
        info: EndpointHealthFailureInfo,
      ) => {
        failures.push({ providerId, endpoint, info });
      },
    },
  };
}

const failure: EndpointHealthFailureInfo = {
  class: "server-error",
  titleId: "tmdb:1",
  at: "2026-07-27T00:00:00.000Z",
};

describe("isCancellationAbort", () => {
  it("treats a live signal as no cancellation", () => {
    expect(isCancellationAbort(new AbortController().signal)).toBe(false);
  });

  it("treats an undefined signal as no cancellation", () => {
    expect(isCancellationAbort(undefined)).toBe(false);
  });

  it("treats the attempt timeout as the endpoint's fault, not a cancellation", () => {
    const controller = new AbortController();
    controller.abort(new ProviderAttemptTimeoutError());
    expect(isCancellationAbort(controller.signal)).toBe(false);
  });

  it("treats any other abort reason as a cancellation", () => {
    const controller = new AbortController();
    controller.abort(new Error("hedged fallback took a winner"));
    expect(isCancellationAbort(controller.signal)).toBe(true);
  });

  it("treats a reasonless abort as a cancellation", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isCancellationAbort(controller.signal)).toBe(true);
  });
});

describe("guardEndpointHealthAgainstCancellation", () => {
  it("records failures while the attempt is still live", () => {
    const { port, failures } = createRecordingPort();
    const controller = new AbortController();
    const guarded = guardEndpointHealthAgainstCancellation(port, controller.signal);

    guarded.recordFailure("videasy", "speedracelight", failure);

    expect(failures).toHaveLength(1);
    expect(failures[0]?.endpoint).toBe("speedracelight");
  });

  it("drops failures reported after a hedge loss cancelled the attempt", () => {
    const { port, failures } = createRecordingPort();
    const controller = new AbortController();
    const guarded = guardEndpointHealthAgainstCancellation(port, controller.signal);

    // Hedging aborts the slower candidate; its catch block then reports.
    controller.abort(new Error("Provider resolve aborted"));
    guarded.recordFailure("videasy", "speedracelight", failure);

    expect(failures).toHaveLength(0);
  });

  it("still records a genuine attempt timeout as endpoint evidence", () => {
    const { port, failures } = createRecordingPort();
    const controller = new AbortController();
    const guarded = guardEndpointHealthAgainstCancellation(port, controller.signal);

    controller.abort(new ProviderAttemptTimeoutError());
    guarded.recordFailure("videasy", "speedracelight", { ...failure, class: "transient" });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.info.class).toBe("transient");
  });

  it("passes reads and successes through even after cancellation", () => {
    const { port, successes } = createRecordingPort();
    const controller = new AbortController();
    const guarded = guardEndpointHealthAgainstCancellation(port, controller.signal);

    controller.abort();

    expect(guarded.shouldTry("videasy", "speedracelight")).toBe(true);
    guarded.recordSuccess("videasy", "speedracelight");
    expect(successes).toEqual(["speedracelight"]);
  });
});
