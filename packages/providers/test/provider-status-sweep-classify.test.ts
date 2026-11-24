import { describe, expect, test } from "bun:test";

import {
  classify,
  composeStatusNote,
  summarizeProbeResolution,
} from "../scripts/provider-status-sweep";

/**
 * The daily sweep commits statuses straight to the docs site — a misread here
 * publishes a confidently wrong board with no human in the loop. Pin the
 * decision table deterministically (upstreamHttp × resolveStatus × streams ×
 * firstFailureCode) since the live probe can never exercise the unhappy rows.
 */
describe("provider-status-sweep classify", () => {
  test("resolved with streams is healthy", () => {
    expect(classify(200, "resolved", 3, undefined)).toEqual({
      status: "healthy",
      note: "",
    });
  });

  test("unreachable upstream without resolution is dead", () => {
    expect(classify(null, "exhausted", 0, "network-error").status).toBe("dead");
    expect(classify(null, "error", 0, "timeout").status).toBe("dead");
  });

  test("unreachable upstream that still resolved stays healthy", () => {
    // The front-door probe is a hint, not a gate — a probe that timed out while
    // resolve succeeded should never publish "dead".
    expect(classify(null, "resolved", 2, undefined).status).toBe("healthy");
  });

  test("blocked failure code describes the refusal observed by the runner", () => {
    expect(classify(403, "exhausted", 0, "blocked")).toEqual({
      status: "blocked",
      note: "upstream denied access from the sweep runner",
    });
  });

  test("upstream 503 reports maintenance", () => {
    expect(classify(503, "exhausted", 0, "provider-unavailable").status).toBe("down");
  });

  test("resolved with zero streams is degraded, not healthy", () => {
    expect(classify(200, "resolved", 0, undefined).status).toBe("degraded");
  });

  test("exhausted with reachable upstream is degraded", () => {
    expect(classify(200, "exhausted", 0, "not-found").status).toBe("degraded");
  });

  test("a classified note keeps the provider's own failure text", () => {
    expect(
      composeStatusNote(
        "upstream up but resolve exhausted",
        "Videasy wings-hdmovie did not produce a playable source",
      ),
    ).toBe(
      "upstream up but resolve exhausted — Videasy wings-hdmovie did not produce a playable source",
    );
  });

  test("an empty class note is the failure text", () => {
    expect(composeStatusNote("", "yt-dlp is required")).toBe("yt-dlp is required");
  });

  test("YouTube health requires a video format discovered by yt-dlp", () => {
    const watchUrlFallback = { metadata: { metadataUnavailable: true } };
    const fallback = summarizeProbeResolution("youtube", 200, {
      status: "resolved",
      streams: [watchUrlFallback],
      failures: [],
    });
    expect(fallback).toEqual({
      status: "degraded",
      note: "yt-dlp did not discover video formats",
      streams: [],
    });

    const format = { metadata: { formatId: "137" } };
    const extracted = summarizeProbeResolution("youtube", 200, {
      status: "resolved",
      streams: [watchUrlFallback, format],
      failures: [],
    });
    expect(extracted).toEqual({ status: "healthy", note: "", streams: [format] });
  });

  test("unclassified resolve status falls through to degraded with the status in the note", () => {
    const row = classify(200, "cancelled", 0, undefined);
    expect(row.status).toBe("degraded");
    expect(row.note).toContain("cancelled");
  });
});
