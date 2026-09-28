import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { rivestreamProviderModule } from "../src/rivestream/direct";

const FIXTURE_BASE = new URL("./fixtures/", import.meta.url);

async function readFixture<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(new URL(path, FIXTURE_BASE)).text()) as T;
}

function resolveRivestream(input: ProviderResolveInput, context: ProviderRuntimeContext) {
  const resolve = rivestreamProviderModule.resolve;
  if (!resolve) throw new Error("rivestream module must expose resolve");
  return resolve(input, context);
}

const MOVIE_INPUT = {
  title: { id: "438631", tmdbId: "438631", kind: "movie", title: "Dune", year: 2021 },
  mediaKind: "movie",
  intent: "play",
  allowedRuntimes: ["direct-http"],
} as unknown as ProviderResolveInput;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("rivestream dead master host", () => {
  test("a 503 ladder probe drops the stream row instead of emitting a corpse", async () => {
    const services = await readFixture<unknown>("rivestream/services-response.json");
    const sourceFixture = await readFixture<unknown>("rivestream/source-response.json");
    const context: ProviderRuntimeContext = {
      now: () => "2026-05-19T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          if (url.includes(".m3u8")) return new Response("gone", { status: 503 });
          return jsonResponse(url.includes("VideoProviderServices") ? services : sourceFixture);
        },
      },
    } as unknown as ProviderRuntimeContext;

    const result = await resolveRivestream(MOVIE_INPUT, context);

    expect(result.status).toBe("exhausted");
    expect(result.streams ?? []).toHaveLength(0);
    expect(result.failures.some((f) => f.message.includes("all masters were unreachable"))).toBe(
      true,
    );
  });

  test("a 403 ladder probe keeps the row (gatekept CDN still plays in mpv)", async () => {
    const services = await readFixture<unknown>("rivestream/services-response.json");
    const sourceFixture = await readFixture<unknown>("rivestream/source-response.json");
    const context: ProviderRuntimeContext = {
      now: () => "2026-05-19T00:00:00.000Z",
      fetch: {
        runtime: "direct-http",
        fetch: async (input) => {
          const url = String(input);
          if (url.includes(".m3u8")) return new Response("Forbidden", { status: 403 });
          return jsonResponse(url.includes("VideoProviderServices") ? services : sourceFixture);
        },
      },
    } as unknown as ProviderRuntimeContext;

    const result = await resolveRivestream(MOVIE_INPUT, context);

    expect(result.status).toBe("resolved");
    expect(result.sources?.length ?? 0).toBeGreaterThan(0);
  });
});
