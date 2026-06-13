import { describe, expect, test } from "bun:test";

import { createQueuePosterResolver } from "@/app-shell/queue-poster-resolver";

describe("createQueuePosterResolver", () => {
  test("returns a persisted poster url by titleId", () => {
    const resolve = createQueuePosterResolver({
      getPosterUrl: (id) => (id === "t1" ? "http://p/t1.jpg" : undefined),
    });
    expect(resolve("t1")).toBe("http://p/t1.jpg");
    expect(resolve("t2")).toBeUndefined();
  });
});
