import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { selectVerifiedStream, verifyCandidateStream } from "../src/shared/resolve-gate";

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

/**
 * A source can offer several qualities, and they do not always share a host. A
 * refused stream is evidence about that stream, so discarding the whole source
 * on the first refusal throws away rungs that might play — the difference
 * between falling back to another server and falling back to another quality on
 * the server that works.
 */
describe("selectVerifiedStream", () => {
  const stream = (id: string, url: string) => ({ id, url, headers: {} });

  test("returns the first stream that verifies", async () => {
    const { context } = contextRecording((url) =>
      url.includes("dead")
        ? new Response("forbidden", { status: 403 })
        : new Response(null, { status: 200 }),
    );

    const result = await selectVerifiedStream({
      streams: [
        stream("a", "https://dead.example/a.mp4"),
        stream("b", "https://live.example/b.mp4"),
      ],
      context,
    });

    expect(result.accepted).toBe(true);
    expect(result.accepted === true && result.stream.id).toBe("b");
  });

  test("rejects only when every stream is refused", async () => {
    const { context } = contextRecording(() => new Response("forbidden", { status: 403 }));

    const result = await selectVerifiedStream({
      streams: [stream("a", "https://a.example/a.mp4"), stream("b", "https://b.example/b.mp4")],
      context,
    });

    expect(result.accepted).toBe(false);
    expect(result.accepted === false && result.reason).toContain("403");
  });

  test("probes each host once, because a host answers the same for every rung", async () => {
    // Counted by distinct URL, not by fetch: one probe of a direct stream is
    // itself a HEAD plus a ranged GET, so raw request count measures the
    // probe's internals rather than this walk.
    const probed: string[] = [];
    const context = {
      fetch: {
        runtime: "direct-http" as const,
        fetch: async (url: string) => {
          probed.push(String(url));
          return new Response("forbidden", { status: 403 });
        },
      },
    } as unknown as ProviderRuntimeContext;

    await selectVerifiedStream({
      streams: [
        stream("a", "https://same.example/1080.mp4"),
        stream("b", "https://same.example/720.mp4"),
        stream("c", "https://same.example/480.mp4"),
      ],
      context,
    });

    expect(new Set(probed).size).toBe(1);
    expect(probed.every((url) => url.includes("1080"))).toBe(true);
  });

  test("rejects an empty candidate rather than reporting success", async () => {
    const { context } = contextRecording(() => new Response(null, { status: 200 }));

    const result = await selectVerifiedStream({ streams: [], context });

    expect(result.accepted).toBe(false);
  });
});
