import { expect, test } from "bun:test";

import {
  fetchLatestVersion,
  parseVersionFromTag,
  resolveReleasesApiUrl,
} from "@/services/update/latest-version";

test("parseVersionFromTag handles v-prefixed and changesets package tags", () => {
  expect(parseVersionFromTag("v1.2.3")).toBe("1.2.3");
  expect(parseVersionFromTag("@kitsunekode/kunai@0.3.0")).toBe("0.3.0");
  expect(parseVersionFromTag("kunai-0.4.1")).toBe("0.4.1");
  expect(parseVersionFromTag(undefined)).toBeNull();
  expect(parseVersionFromTag("nightly")).toBeNull();
});

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

test("resolveReleasesApiUrl honors KUNAI_RELEASES_API override", () => {
  const prev = process.env.KUNAI_RELEASES_API;
  process.env.KUNAI_RELEASES_API = "http://127.0.0.1:9/mock.json";
  expect(resolveReleasesApiUrl()).toBe("http://127.0.0.1:9/mock.json");
  delete process.env.KUNAI_RELEASES_API;
  if (prev !== undefined) process.env.KUNAI_RELEASES_API = prev;
  expect(resolveReleasesApiUrl()).toContain("github.com");
});

test("returns null when fetch throws", async () => {
  const throwing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  expect(await fetchLatestVersion(throwing)).toBeNull();
});
