import { describe, expect, test } from "bun:test";

import { encryptVidrockItemId } from "../src/vidrock/direct";

describe("VidRock item-id encryption", () => {
  test("matches the previous crypto-js AES-CBC output byte-for-byte", () => {
    expect(encryptVidrockItemId("438631")).toBe("pFIeN33FkN39njpBQdUj2A");
    expect(encryptVidrockItemId("1396_1_2")).toBe("V9-JX8ZAh858aKFVMVPrRA");
  });
});
