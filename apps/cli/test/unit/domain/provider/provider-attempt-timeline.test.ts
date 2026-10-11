import { describe, expect, test } from "bun:test";

import {
  createProviderAttemptTimeline,
  summarizeProviderAttemptTimeline,
} from "@/domain/provider/ProviderAttemptTimeline";

describe("ProviderAttemptTimeline", () => {
  test("records primary failure, fallback transition, and fallback success", () => {
    const timeline = createProviderAttemptTimeline({
      traceId: "trace-1",
      maxAttempts: 20,
    });

    timeline.record({
      type: "attempt-started",
      attemptId: "a1",
      providerId: "vidking",
      reason: "primary",
      at: 1,
    });
    timeline.record({
      type: "attempt-failed",
      attemptId: "a1",
      providerId: "vidking",
      at: 2,
      failureClass: "timeout",
      retryable: true,
      userSummary: "VidKing timed out",
      developerDetail: "provider request exceeded 15000ms",
    });
    timeline.record({
      type: "fallback-started",
      attemptId: "a2",
      fromProviderId: "vidking",
      toProviderId: "rivestream",
      reason: "timeout",
      at: 3,
    });
    timeline.record({
      type: "attempt-succeeded",
      attemptId: "a2",
      providerId: "rivestream",
      at: 4,
      cacheHit: false,
      streamCount: 2,
    });

    const summary = summarizeProviderAttemptTimeline(timeline.snapshot());
    expect(summary.status).toBe("recovered");
    expect(summary.primaryFailure).toContain("VidKing timed out");
    expect(summary.currentUserMessage).toContain("Recovered via Rivestream");
    expect(summary.attempts).toHaveLength(2);
  });

  test("records final failure after exhausted attempts", () => {
    const timeline = createProviderAttemptTimeline({ traceId: "trace-final" });
    timeline.record({
      type: "attempt-started",
      attemptId: "a1",
      providerId: "vidking",
      reason: "primary",
      at: 1,
    });
    timeline.record({
      type: "attempt-failed",
      attemptId: "a1",
      providerId: "vidking",
      at: 2,
      failureClass: "provider-empty",
      retryable: true,
      userSummary: "No stream was returned",
      developerDetail: "empty stream list",
    });
    timeline.record({
      type: "final-failed",
      at: 3,
      userSummary: "No playable stream found after 1 provider",
    });

    const summary = summarizeProviderAttemptTimeline(timeline.snapshot());
    expect(summary.status).toBe("failed");
    expect(summary.currentUserMessage).toContain("No playable stream found");
    expect(summary.primaryFailure).toBe("No stream was returned");
  });

  test("records an aborted attempt without fabricating a provider failure", () => {
    const timeline = createProviderAttemptTimeline({
      traceId: "trace-aborted",
      maxAttempts: 20,
    });

    timeline.record({
      type: "attempt-started",
      attemptId: "a1",
      providerId: "vidking",
      reason: "primary",
      at: 1,
    });
    timeline.record({
      type: "attempt-aborted",
      attemptId: "a1",
      providerId: "vidking",
      at: 2,
    });

    const snapshot = timeline.snapshot();
    const attempt = snapshot.attempts[0];
    expect(attempt?.status).toBe("aborted");
    // Cancellation must not masquerade as a provider fault.
    expect(attempt?.failureClass).toBeUndefined();
    expect(attempt?.userSummary).toBeUndefined();
    expect(snapshot.events.map((event) => event.type)).toContain("attempt-aborted");
  });

  test("caps attempts and events for long sessions", () => {
    const timeline = createProviderAttemptTimeline({
      traceId: "trace-long",
      maxAttempts: 3,
      maxEvents: 5,
    });

    for (let index = 0; index < 10; index += 1) {
      timeline.record({
        type: "attempt-started",
        attemptId: `a${index}`,
        providerId: `p${index}`,
        reason: "fallback",
        at: index,
      });
      timeline.record({
        type: "attempt-failed",
        attemptId: `a${index}`,
        providerId: `p${index}`,
        at: index + 0.5,
        failureClass: "network",
        retryable: true,
        userSummary: "Network failed",
        developerDetail: "synthetic network failure",
      });
    }

    const snapshot = timeline.snapshot();
    expect(snapshot.attempts.length).toBeLessThanOrEqual(3);
    expect(snapshot.events.length).toBeLessThanOrEqual(5);
    expect(snapshot.truncated).toBe(true);
  });
});
