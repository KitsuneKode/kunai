import { expect, test } from "bun:test";

import { fetchLatestVersion } from "@/services/update/latest-version";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

test("strips the leading v from the tag", async () => {
  const v = await fetchLatestVersion(fakeFetch(200, { tag_name: "v1.4.2" }));
  expect(v).toBe("1.4.2");
});

test("returns null on non-ok response", async () => {
  const v = await fetchLatestVersion(fakeFetch(404, {}));
  expect(v).toBeNull();
});

test("returns null when fetch throws", async () => {
  const throwing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  expect(await fetchLatestVersion(throwing)).toBeNull();
});
