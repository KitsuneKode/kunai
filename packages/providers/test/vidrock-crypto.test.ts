import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  decryptVidrockStreamUrl,
  VIDROCK_KEY_HEX,
  vidrockProviderModule,
} from "../src/vidrock/direct";

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

describe("VidRock key pin", () => {
  test("pinned key is a 256-bit hex constant", () => {
    // Rotation canary: the GCM key is 32 bytes recovered from the player
    // bundle — a redeploy with a new key fails the decrypt test above, and
    // this shape pin says which half is stale. Recovery:
    // `.docs/provider-dossiers/vidrock.md` (key rotation).
    expect(VIDROCK_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
    expect(VIDROCK_KEY_HEX.length / 2).toBe(32);
  });

  test("every lane failing decrypt is a diagnosable rotation signal, not a title miss", async () => {
    const ctx: ProviderRuntimeContext = {
      providerId: "vidrock",
      now: () => "2026-09-21T00:00:00.000Z",
      // SAFETY: test stub — supplies only the fetch surface this module calls.
      fetch: {
        runtime: "direct-http",
        fetch: async () =>
          new Response(
            JSON.stringify({
              primary: { url: "!!!not-base64!!!" },
              backup: { url: "e30=" },
            }),
            { status: 200 },
          ),
      } as ProviderRuntimeContext["fetch"],
    };
    const result = await vidrockProviderModule.resolve(
      {
        title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
        mediaKind: "movie",
        intent: "play",
        allowedRuntimes: ["direct-http"],
      },
      ctx,
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures?.[0]?.code).toBe("parse-failed");
    expect(result.failures?.[0]?.retryable).toBe(false);
    expect(result.failures?.[0]?.message).toMatch(/rotat/);
  });
});
