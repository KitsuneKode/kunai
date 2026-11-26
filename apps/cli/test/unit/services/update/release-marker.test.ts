import { describe, expect, test } from "bun:test";

import {
  RELEASE_MARKER_NAMES,
  releaseMarkerSkipped,
  startReleaseMarkerFetch,
} from "@/services/update/release-marker";

describe("release marker opt-outs", () => {
  test.each([
    [{ DO_NOT_TRACK: "1" }],
    [{ DO_NOT_TRACK: "true" }],
    [{ CI: "true" }],
    [{ CI: "YES" }],
    [{ KUNAI_NO_MARKER: "1" }],
  ])("%j skips the marker", (env) => {
    expect(releaseMarkerSkipped(env)).toBe(true);
    let calls = 0;
    const started = startReleaseMarkerFetch({
      dlBase: "https://example.test/releases",
      version: "1.2.3",
      marker: "update.marker",
      env,
      fetchImpl: async () => {
        calls += 1;
        return new Response("ok");
      },
    });
    expect(started).toBeNull();
    expect(calls).toBe(0);
  });

  test("a value that says no does not skip it", () => {
    expect(releaseMarkerSkipped({ DO_NOT_TRACK: "0", CI: "false", KUNAI_NO_MARKER: "" })).toBe(
      false,
    );
  });
});

describe("release marker fetch", () => {
  test("requests this release's marker from the download base once", async () => {
    const urls: string[] = [];
    await startReleaseMarkerFetch({
      dlBase: "https://example.test/releases",
      version: "1.2.3",
      marker: "update.marker",
      env: {},
      fetchImpl: async (url) => {
        urls.push(url);
        return new Response("ok");
      },
    });
    expect(urls).toEqual(["https://example.test/releases/download/v1.2.3/update.marker"]);
    expect(RELEASE_MARKER_NAMES).toEqual(["install.marker", "update.marker"]);
  });

  test("a failure is swallowed, never retried", async () => {
    let calls = 0;
    const started = startReleaseMarkerFetch({
      dlBase: "https://example.test/releases",
      version: "1.2.3",
      marker: "update.marker",
      env: {},
      fetchImpl: async () => {
        calls += 1;
        throw new Error("offline");
      },
    });
    await expect(started).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  test("a hung request is aborted by its timeout and still settles", async () => {
    let aborted = false;
    const started = startReleaseMarkerFetch({
      dlBase: "https://example.test/releases",
      version: "1.2.3",
      marker: "update.marker",
      env: {},
      timeoutMs: 0,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    });
    await expect(started).resolves.toBeUndefined();
    expect(aborted).toBe(true);
  });
});
