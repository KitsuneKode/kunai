import { expect, test } from "bun:test";

import { anidbGuardedFetch } from "../src/anidb/client";

test("a relay refusal is not retried as a direct request", async () => {
  const refusal = new Error("Relay refused the request (host)");
  refusal.name = "RelayRefusalError";
  await expect(
    anidbGuardedFetch("https://anidb.example/playlist.m3u8", undefined, {
      context: {
        now: () => "2026-10-01T00:00:00.000Z",
        fetch: {
          runtime: "direct-http",
          resolvesLocally: false,
          fetch: async () => {
            throw refusal;
          },
        },
      },
    }),
  ).rejects.toMatchObject({ name: "RelayRefusalError" });
});
