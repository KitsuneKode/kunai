import { describe, expect, test } from "bun:test";

import { HLS_SEGMENT_PROBE_MIN_BYTES } from "../src/shared/hls-manifest";
import { probeStreamReachability } from "../src/shared/stream-reachability";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];

function bytes(size: number, fill = 0xab): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

function withPrefix(prefix: readonly number[], size = HLS_SEGMENT_PROBE_MIN_BYTES * 4): Uint8Array {
  const out = bytes(size);
  out.set(prefix, 0);
  return out;
}

/** Three TS packets starting at `offset`. */
function withTsAt(body: Uint8Array, offset: number): Uint8Array {
  for (let packet = 0; packet < 3; packet += 1) body[offset + packet * 188] = 0x47;
  return body;
}

async function probeSegment(segment: Uint8Array, contentType: string) {
  return probeStreamReachability({
    url: "https://cdn.example/stream.m3u8",
    fetchImpl: async (url: string) =>
      url.endsWith("stream.m3u8")
        ? new Response("#EXTM3U\n#EXTINF:3,\n/seg-1.png\n", { status: 200 })
        : new Response(segment, { status: 206, headers: { "content-type": contentType } }),
    timeoutMs: 500,
  });
}

describe("decoy HLS segments", () => {
  test("a PNG served as a segment is a definitive refusal", async () => {
    const probe = await probeSegment(withPrefix(PNG_MAGIC), "image/png");
    expect(probe).toMatchObject({ status: "unreachable", definitive: true });
    if (probe.status === "unreachable") expect(probe.reason).toContain("image-container decoy");
  });

  test("the decoy is caught by its bytes even when it claims to be video", async () => {
    const probe = await probeSegment(withPrefix(JPEG_MAGIC), "video/mp2t");
    expect(probe).toMatchObject({ status: "unreachable", definitive: true });
  });

  test("TS bytes mislabelled image/jpeg still pass", async () => {
    const probe = await probeSegment(
      withTsAt(bytes(HLS_SEGMENT_PROBE_MIN_BYTES * 2), 0),
      "image/jpeg",
    );
    expect(probe.status).toBe("reachable");
  });

  test("TS hidden behind a small image header is media, not a decoy", async () => {
    // ffmpeg resyncs past a fake picture header; refusing it would drop a playable lane.
    const segment = withTsAt(withPrefix(PNG_MAGIC, 8 * 1024), 70);
    const probe = await probeSegment(segment, "image/png");
    expect(probe.status).toBe("reachable");
  });

  test("an image header with no TS run anywhere is still refused", async () => {
    const segment = withPrefix(PNG_MAGIC, 8 * 1024);
    // Two sync bytes 188 apart are not a TS run.
    segment[300] = 0x47;
    segment[488] = 0x47;
    const probe = await probeSegment(segment, "image/png");
    expect(probe.status).toBe("unreachable");
  });
});

describe("extensionless HLS manifests", () => {
  test("a reachable URL served as mpegurl is validated down to its first segment", async () => {
    const urls: string[] = [];
    const probe = await probeStreamReachability({
      url: "https://cdn.example/play?id=1",
      fetchImpl: async (url: string, init?: RequestInit) => {
        urls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("seg-1")) {
          return new Response(withPrefix(PNG_MAGIC), {
            status: 206,
            headers: { "content-type": "image/png" },
          });
        }
        return new Response("#EXTM3U\n#EXTINF:3,\n/seg-1.ts\n", {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      },
      timeoutMs: 500,
    });
    // Before, a 200 on the HEAD was taken as "reachable" and the decoy shipped.
    expect(probe.status).toBe("unreachable");
    expect(urls.some((entry) => entry.includes("seg-1.ts"))).toBe(true);
  });
});
