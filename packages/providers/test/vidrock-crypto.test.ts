import { describe, expect, test } from "bun:test";

import { decryptVidrockStreamUrl } from "../src/vidrock/direct";

// Captured live from GET https://vidrock.net/api/movie/550 on 2026-09-21. The
// upstream path segment rotates, so the assertion is on the stable parts of
// the decrypted URL, not the token.
const LIVE_CIPHERTEXT =
  "NIKrKo4CVDg1AMVqP0O--Gqc3aWs3oAVb7OXXjP4r_YSu20-FcPiShtsCCf8nNwnEy3iSDroInp3MrZRIrg8lG_FvHMEp8-81NzlDkYTA5jBWfIlnMDN1vkWrHZMwPX-LdDOsUi4-3M3MTReq7Q4AqiqYJh2JEW3zaY";

describe("VidRock stream-url decryption", () => {
  test("decrypts a captured AES-256-GCM lane ciphertext to a stream URL", async () => {
    const url = await decryptVidrockStreamUrl(LIVE_CIPHERTEXT);
    expect(url.startsWith("https://cdn.ngcorp.dad/movie/")).toBe(true);
    expect(url.endsWith(".m3u8")).toBe(true);
  });

  test("rejects malformed ciphertexts instead of returning garbage", async () => {
    await expect(decryptVidrockStreamUrl("too-short")).rejects.toThrow();
    await expect(decryptVidrockStreamUrl(`${LIVE_CIPHERTEXT}xx`)).rejects.toThrow();
  });
});
