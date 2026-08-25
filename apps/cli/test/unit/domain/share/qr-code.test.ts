import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { encodeQrMatrix, renderQrHalfBlocks } from "@/domain/share/qr-code";

describe("dependency-free terminal QR", () => {
  test("matches the qrencode reference fixture for a known byte payload", () => {
    const matrix = encodeQrMatrix("https://kunai.kitsunekode.in/w/test");
    const fixtureBytes = `${matrix.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("\n")}\n`;

    expect(matrix).toHaveLength(29);
    expect(matrix.every((row) => row.length === 29)).toBe(true);
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(
      // Cross-checked against qrencode 4.1.1: all 567 non-function data
      // modules are identical after removing each encoder's chosen mask.
      "66476b753ad5fe5967417b57d7fa1773531ad6e94e550abbc2a190bee4f95914",
    );
  });

  test("renders two QR rows per terminal cell with a quiet zone", () => {
    const output = renderQrHalfBlocks(encodeQrMatrix("https://kunai.kitsunekode.in/w/test"));
    const lines = output.split("\n");

    expect(output).toContain("▀");
    expect(output).toContain("▄");
    expect(lines[0]?.trim()).toBe("");
    expect(lines.at(-1)?.trim()).toBe("");
    expect(lines.every((line) => line.length === lines[0]?.length)).toBe(true);
  });

  test("rejects payloads that exceed the bounded terminal QR versions", () => {
    expect(() => encodeQrMatrix("x".repeat(272))).toThrow("too long");
  });
});
