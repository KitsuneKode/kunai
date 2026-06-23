import { describe, expect, test } from "bun:test";

import { appReleasePageUrl } from "@/services/update/release-url";

describe("appReleasePageUrl", () => {
  test("deep-links to the tagged release for a known version", () => {
    expect(appReleasePageUrl("1.4.0")).toBe(
      "https://github.com/KitsuneKode/kunai/releases/tag/v1.4.0",
    );
  });

  test("does not double-prefix a version that already has a leading v", () => {
    expect(appReleasePageUrl("v2.0.1")).toBe(
      "https://github.com/KitsuneKode/kunai/releases/tag/v2.0.1",
    );
  });

  test("falls back to the latest release page when version is unknown", () => {
    expect(appReleasePageUrl(null)).toBe("https://github.com/KitsuneKode/kunai/releases/latest");
    expect(appReleasePageUrl("  ")).toBe("https://github.com/KitsuneKode/kunai/releases/latest");
  });
});
