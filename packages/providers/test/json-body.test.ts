import { describe, expect, test } from "bun:test";

import { readJsonObjectBody } from "../src/shared/json-body";

const json = (body: string) =>
  new Response(body, { headers: { "content-type": "application/json" } });

describe("readJsonObjectBody", () => {
  test("a JSON null body is no payload, not an object to read fields off", async () => {
    // VidLink answers 200 with exactly this while it has no source; the cast it
    // replaced turned the next property read into `null is not an object`.
    expect(await readJsonObjectBody(json("null"))).toBeNull();
  });

  test("returns the object when there is one", async () => {
    expect(
      await readJsonObjectBody<{ stream?: { url: string } }>(json('{"stream":{"url":"u"}}')),
    ).toEqual({
      stream: { url: "u" },
    });
  });

  test("an array body is a payload — some endpoints answer with one", async () => {
    expect(await readJsonObjectBody<readonly number[]>(json("[1,2]"))).toEqual([1, 2]);
  });

  test("a bare scalar is no payload either", async () => {
    expect(await readJsonObjectBody(json('"done"'))).toBeNull();
    expect(await readJsonObjectBody(json("7"))).toBeNull();
    expect(await readJsonObjectBody(json("false"))).toBeNull();
  });

  test("a body that is not JSON at all still throws — that is a broken response", async () => {
    await expect(readJsonObjectBody(json("<html>nope</html>"))).rejects.toThrow();
  });
});
