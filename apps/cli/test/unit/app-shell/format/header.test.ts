import { describe, expect, test } from "bun:test";

import { composeHeader } from "@/app-shell/format/header";

describe("composeHeader", () => {
  test("builds brand, destination pill, context, and right cluster", () => {
    const h = composeHeader({
      brand: "🦊 Kunai",
      destination: "Browse",
      context: "vidking · series",
      status: "ready",
      size: "182×40",
    });
    expect(h.brand).toBe("🦊 Kunai");
    expect(h.pill).toBe(" Browse ");
    expect(h.context).toBe("vidking · series");
    expect(h.right).toBe("ready · 182×40");
  });
  test("omits empty context and size cleanly", () => {
    const h = composeHeader({ brand: "🦊 Kunai", destination: "Stats", status: "ready" });
    expect(h.context).toBe("");
    expect(h.right).toBe("ready");
  });
});
