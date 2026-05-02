import { describe, expect, test } from "bun:test";

import { buildStreamHeaders, decodeTobeparsed, resolveAnimeEpisodeString } from "../src/index";

const TEST_KEY_RAW = "Xot36i3lK3:v1";

describe("decodeTobeparsed", () => {
  test("decodes the current versioned allmanga blob layout", async () => {
    const plain =
      '{"sourceUrl":"--68656c6c6f","sourceName":"Default"}' +
      '{"sourceUrl":"--776f726c64","sourceName":"Yt-mp4"}';
    const blob = await buildBlob(plain);

    await expect(decodeTobeparsed(blob)).resolves.toEqual([
      { sourceUrl: "68656c6c6f", sourceName: "Default" },
      { sourceUrl: "776f726c64", sourceName: "Yt-mp4" },
    ]);
  });
});

describe("buildStreamHeaders", () => {
  test("prefers the stream-specific referer when one is required", () => {
    expect(buildStreamHeaders("https://cdn.example/ref", "https://allmanga.to", "ua")).toEqual({
      Referer: "https://cdn.example/ref",
      "User-Agent": "ua",
    });
  });

  test("falls back to the provider referer when the stream has no override", () => {
    expect(buildStreamHeaders(undefined, "https://allmanga.to", "ua")).toEqual({
      Referer: "https://allmanga.to",
      "User-Agent": "ua",
    });
  });
});

describe("resolveAnimeEpisodeString", () => {
  test("matches the exact episode number even when the upstream list is reverse ordered", () => {
    expect(
      resolveAnimeEpisodeString(["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"], 1),
    ).toBe("1");
    expect(
      resolveAnimeEpisodeString(
        ["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
        12,
      ),
    ).toBe("12");
  });

  test("falls back to positional lookup when an exact numeric match is unavailable", () => {
    expect(resolveAnimeEpisodeString(["special-a", "special-b"], 2)).toBe("special-b");
  });
});

async function buildBlob(plain: string): Promise<string> {
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const footer = Uint8Array.from({ length: 16 }, (_, index) => 200 + index);
  const version = new Uint8Array([1]);
  const counter = new Uint8Array(16);
  counter.set(iv, 0);
  counter[15] = 2;

  const keyBytes = new TextEncoder().encode(TEST_KEY_RAW);
  const hashBuf = await crypto.subtle.digest("SHA-256", keyBytes);
  const key = await crypto.subtle.importKey("raw", hashBuf, { name: "AES-CTR" }, false, [
    "encrypt",
  ]);

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CTR", counter, length: 64 },
      key,
      new TextEncoder().encode(plain),
    ),
  );

  const bytes = new Uint8Array(version.length + iv.length + encrypted.length + footer.length);
  bytes.set(version, 0);
  bytes.set(iv, version.length);
  bytes.set(encrypted, version.length + iv.length);
  bytes.set(footer, version.length + iv.length + encrypted.length);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
