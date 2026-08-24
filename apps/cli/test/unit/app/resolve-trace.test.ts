import { describe, expect, test } from "bun:test";

import {
  audioFallbackNoticeFromTrace,
  createResolveTraceStub,
  finalizeResolveTrace,
} from "@/app/playback/resolve-trace";
import type { TitleInfo } from "@/domain/types";
import type { ProviderFailure } from "@kunai/types";

const title: TitleInfo = { id: "550", name: "Fight Club", type: "movie", year: "1999" };

function started() {
  return createResolveTraceStub({ title, providerId: "videasy", mode: "series" });
}

describe("finalizeResolveTrace", () => {
  test("stamps the outcome onto the started trace", () => {
    const trace = started();
    const endedAt = "2026-07-28T12:00:05.000Z";

    const finished = finalizeResolveTrace(trace, {
      endedAt,
      selectedProviderId: "videasy",
      selectedStreamId: "stream-1",
      cacheHit: false,
      failures: [],
    });

    expect(finished.id).toBe(trace.id);
    expect(finished.endedAt).toBe(endedAt);
    expect(finished.selectedStreamId).toBe("stream-1");
    expect(finished.cacheHit).toBe(false);
  });

  test("keeps the failures that explain a fallback", () => {
    const failures: readonly ProviderFailure[] = [
      {
        providerId: "videasy",
        code: "timeout",
        message: "candidate timed out",
        retryable: false,
        at: "2026-07-28T12:00:03.000Z",
      },
    ];

    const finished = finalizeResolveTrace(started(), {
      endedAt: "2026-07-28T12:00:05.000Z",
      selectedProviderId: "vidlink",
      cacheHit: false,
      failures,
    });

    expect(finished.failures).toHaveLength(1);
    // The provider that actually won, not the one first attempted.
    expect(finished.selectedProviderId).toBe("vidlink");
  });

  test("falls back to the originally attempted provider when none is given", () => {
    const finished = finalizeResolveTrace(started(), {
      endedAt: "2026-07-28T12:00:05.000Z",
      cacheHit: true,
      failures: [],
    });

    expect(finished.selectedProviderId).toBe("videasy");
  });

  test("does not mutate the trace it was given", () => {
    const trace = started();

    finalizeResolveTrace(trace, {
      endedAt: "2026-07-28T12:00:05.000Z",
      cacheHit: true,
      failures: [],
    });

    expect(trace.endedAt).toBeUndefined();
    expect(trace.cacheHit).toBe(false);
  });

  test("keeps the steps recorded while resolving", () => {
    const finished = finalizeResolveTrace(started(), {
      endedAt: "2026-07-28T12:00:05.000Z",
      cacheHit: false,
      failures: [],
    });

    expect(finished.steps).toHaveLength(1);
    expect(finished.startedAt).toBeTruthy();
  });
});

describe("audioFallbackNoticeFromTrace", () => {
  const at = new Date().toISOString();

  test("a dub->sub downgrade produces a user-facing notice", () => {
    const note = audioFallbackNoticeFromTrace([
      {
        type: "audio:fallback",
        providerId: "miruro",
        at,
        message: "requested dub, resolved sub",
        attributes: { requested: "dub", resolved: "sub" },
      },
    ]);
    expect(note).toBe("Dub unavailable — playing Sub");
  });

  test("no audio:fallback event means no notice", () => {
    expect(
      audioFallbackNoticeFromTrace([
        { type: "provider:success", providerId: "miruro", at, message: "ok" },
      ]),
    ).toBeNull();
    expect(audioFallbackNoticeFromTrace(undefined)).toBeNull();
  });

  test("an event with unknown presentations is ignored, not mislabelled", () => {
    expect(
      audioFallbackNoticeFromTrace([
        {
          type: "audio:fallback",
          providerId: "miruro",
          at,
          message: "weird",
          attributes: { requested: "external", resolved: "sub" },
        },
      ]),
    ).toBeNull();
  });
});
