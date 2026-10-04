import { describe, expect, test } from "bun:test";

import {
  checkStreamPreflight,
  type StreamHealthFetch,
} from "@/services/playback/stream-health-check";

function response(status: number): Response {
  return new Response(null, { status });
}

describe("checkStreamPreflight", () => {
  test("bypasses preflight (returns reachable) for ytdl/youtube streams", async () => {
    const fetchImpl: StreamHealthFetch = async () => response(404);

    // Using requiresYtdl
    const result1 = await checkStreamPreflight("https://cdn.example/vid.m3u8", {}, 50, {
      requiresYtdl: true,
      fetchImpl,
    });
    expect(result1.status).toBe("reachable");

    // Using youtube URL
    const result2 = await checkStreamPreflight("https://www.youtube.com/watch?v=1234", {}, 50, {
      fetchImpl,
    });
    expect(result2.status).toBe("reachable");
  });
});
