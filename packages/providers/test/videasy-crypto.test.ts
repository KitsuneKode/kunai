import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeWingsdatabasePayload } from "../src/videasy/crypto";

describe("videasy wings enc=2 crypto", () => {
  test("decrypts captured neon2 payload (sparse PRNG state)", () => {
    const fixturePath = join(import.meta.dir, "fixtures/videasy/wings-enc2-neon2.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      mediaId: number;
      seed: string;
      cipher: string;
      expectedSourceCount: number;
      expectedKeys: string[];
    };

    const plain = decodeWingsdatabasePayload(fixture.cipher, fixture.seed, fixture.mediaId);
    const data = JSON.parse(plain) as {
      sources?: unknown[];
      subtitles?: unknown[];
    };

    expect(Object.keys(data).sort()).toEqual(fixture.expectedKeys);
    expect(data.sources).toHaveLength(fixture.expectedSourceCount);
    expect(Array.isArray(data.sources)).toBe(true);
  });

  test("rejects bad seed with magic-byte error", () => {
    const fixturePath = join(import.meta.dir, "fixtures/videasy/wings-enc2-neon2.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      mediaId: number;
      cipher: string;
    };

    expect(() =>
      decodeWingsdatabasePayload(fixture.cipher, "00000000.invalid-seed-value-xx", fixture.mediaId),
    ).toThrow(/magic byte/);
  });
});
