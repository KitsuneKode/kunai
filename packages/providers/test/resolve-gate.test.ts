import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { verifyCandidateStream } from "../src/shared/resolve-gate";

/**
 * The gate exists to make "verified" and "shipped" the same request.
 *
 * Videasy proved why: it probed a stream with `Origin: vidking.net`, got 200,
 * and shipped the identical URL with `Origin: cineby.at`, which the CDN
 * refused. Both halves were individually reasonable; the bug was that they were
 * assembled twice.
 */
function contextRecording(handler: (url: string, init?: RequestInit) => Response): {
  readonly context: ProviderRuntimeContext;
  readonly seen: RequestInit[];
} {
  const seen: RequestInit[] = [];
  const context = {
    fetch: {
      runtime: "direct-http" as const,
      fetch: async (url: string, init?: RequestInit) => {
        seen.push(init ?? {});
        return handler(String(url), init);
      },
    },
  } as unknown as ProviderRuntimeContext;
  return { context, seen };
}

const PLAYLIST = "#EXTM3U\n#EXTINF:4.0,\nsegment-0.ts\n";

describe("verifyCandidateStream", () => {
  test("probes with the candidate's own headers, verbatim", async () => {
    const { context, seen } = contextRecording((url) =>
      url.endsWith(".m3u8")
        ? new Response(PLAYLIST, { status: 200 })
        : new Response(new Uint8Array(2048), { status: 206 }),
    );

    await verifyCandidateStream({
      stream: {
        url: "https://cdn.example/master.m3u8",
        headers: { referer: "https://site.example/watch", origin: "https://player.example" },
      },
      context,
    });

    expect(seen[0]?.headers).toMatchObject({
      referer: "https://site.example/watch",
      origin: "https://player.example",
    });
  });

  test("accepts a stream whose segment is reachable", async () => {
    const { context } = contextRecording((url) =>
      url.endsWith(".m3u8")
        ? new Response(PLAYLIST, { status: 200 })
        : new Response(new Uint8Array(2048), { status: 206 }),
    );

    const verdict = await verifyCandidateStream({
      stream: { url: "https://cdn.example/master.m3u8", headers: {} },
      context,
    });

    expect(verdict).toMatchObject({ accepted: true, verified: true });
  });

  test("rejects a stream whose segment is definitively refused", async () => {
    const { context } = contextRecording((url) =>
      url.endsWith(".m3u8")
        ? new Response(PLAYLIST, { status: 200 })
        : new Response("domain forbidden", { status: 403 }),
    );

    const verdict = await verifyCandidateStream({
      stream: { url: "https://cdn.example/master.m3u8", headers: {} },
      context,
    });

    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted === false && verdict.reason).toContain("403");
  });

  test("a probe that never reached a verdict is accepted but not verified", async () => {
    // `verified` feeds `streamReachabilityVerified`, and that flag makes later
    // phases skip probing as "provider-attested". Letting a timeout or an
    // inconclusive probe set it promotes an unproven stream to a proven one and
    // switches off the playback preflight that would have caught it.
    const { context } = contextRecording(() => new Response("", { status: 500 }));

    const verdict = await verifyCandidateStream({
      stream: { url: "https://cdn.example/video.mp4", headers: {} },
      context,
    });

    expect(verdict).toMatchObject({ accepted: true, verified: false });
  });

  test("accepts when the refusal is not definitive", async () => {
    const { context } = contextRecording(() => new Response("", { status: 500 }));

    const verdict = await verifyCandidateStream({
      stream: { url: "https://cdn.example/video.mp4", headers: {} },
      context,
    });

    expect(verdict.accepted).toBe(true);
  });

  test("rejects a candidate with no url rather than probing nothing", async () => {
    const { context } = contextRecording(() => new Response("", { status: 200 }));

    const verdict = await verifyCandidateStream({ stream: { url: "  ", headers: {} }, context });

    expect(verdict).toMatchObject({ accepted: false });
  });
});
