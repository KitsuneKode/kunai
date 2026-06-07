import { describe, expect, test } from "bun:test";

import { decodeShareCode, encodeShareCode } from "@/domain/share/share-code";

describe("share-code", () => {
  test("round-trips a series title with season/episode", () => {
    const code = encodeShareCode({
      id: "tmdb:1399",
      type: "series",
      name: "Game of Thrones",
      season: 2,
      episode: 5,
    });
    expect(code.startsWith("kunai1:")).toBe(true);
    expect(decodeShareCode(code)).toEqual({
      id: "tmdb:1399",
      type: "series",
      name: "Game of Thrones",
      season: 2,
      episode: 5,
    });
  });

  test("round-trips a movie without episode fields", () => {
    const code = encodeShareCode({ id: "tmdb:603", type: "movie", name: "The Matrix" });
    expect(decodeShareCode(code)).toEqual({ id: "tmdb:603", type: "movie", name: "The Matrix" });
  });

  test("extracts a code embedded in pasted surrounding text", () => {
    const code = encodeShareCode({ id: "tmdb:1", type: "movie", name: "X" });
    expect(decodeShareCode(`hey watch this: ${code} — it's great`)?.id).toBe("tmdb:1");
  });

  test("returns null for non-codes and corrupt payloads", () => {
    expect(decodeShareCode("just some text")).toBeNull();
    expect(decodeShareCode("kunai1:!!!notbase64!!!")).toBeNull();
    expect(decodeShareCode("kunai1:" + Buffer.from('{"id":""}').toString("base64url"))).toBeNull();
  });
});
