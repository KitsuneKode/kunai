import { describe, expect, test } from "bun:test";

import { buildItermInlineImage } from "@/image/renderers/iterm-inline";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

describe("buildItermInlineImage", () => {
  test("wraps the payload in OSC 1337 File and terminates with BEL", () => {
    const escape = buildItermInlineImage(PNG, { rows: 6, cols: 12 });

    expect(escape?.startsWith("]1337;File=")).toBe(true);
    expect(escape?.endsWith("")).toBe(true);
  });

  test("transmits the prepared PNG verbatim as base64", () => {
    const escape = buildItermInlineImage(PNG, { rows: 6, cols: 12 });

    // Verbatim transmission is the whole point: no quantisation, unlike sixel.
    const payload = escape?.slice(escape.indexOf(":") + 1, -1);
    expect(payload).toBe(Buffer.from(PNG).toString("base64"));
    expect(Buffer.from(payload ?? "", "base64")).toEqual(Buffer.from(PNG));
  });

  test("declares the size in cells so the image stays inside its reserved box", () => {
    const escape = buildItermInlineImage(PNG, { rows: 6, cols: 12 });

    // Without an explicit cell size iTerm2 scales to the image's own pixel
    // dimensions and pushes the surrounding layout.
    expect(escape).toContain("width=12");
    expect(escape).toContain("height=6");
    expect(escape).toContain("preserveAspectRatio=1");
    expect(escape).toContain("inline=1");
  });

  test("declares the byte size, which the protocol requires", () => {
    expect(buildItermInlineImage(PNG, { rows: 2, cols: 2 })).toContain(`size=${PNG.byteLength}`);
  });

  test("does not move the cursor, so the overlay keeps its own position", () => {
    expect(buildItermInlineImage(PNG, { rows: 2, cols: 2 })).toContain("doNotMoveCursor=1");
  });

  test("emits no escape at all for degenerate input", () => {
    // A broken poster must degrade to text, never to a half-written escape that
    // would leave the terminal parsing garbage.
    expect(buildItermInlineImage(new Uint8Array(), { rows: 4, cols: 4 })).toBeNull();
    expect(buildItermInlineImage(PNG, { rows: 0, cols: 4 })).toBeNull();
    expect(buildItermInlineImage(PNG, { rows: 4, cols: 0 })).toBeNull();
    expect(buildItermInlineImage(PNG, { rows: -1, cols: 4 })).toBeNull();
  });

  test("contains no bare newline that Ink could measure as a row", () => {
    const escape = buildItermInlineImage(PNG, { rows: 4, cols: 4 }) ?? "";

    expect(escape.includes("\n")).toBe(false);
  });
});
