import { describe, expect, test } from "bun:test";

import { fitSettingsRowText } from "@/app-shell/settings/components/row-layout";

describe("fitSettingsRowText", () => {
  test("sanitizes terminal-unsafe value text before the normal-width path", () => {
    const fitted = fitSettingsRowText({
      width: 80,
      prefix: "",
      label: "Download path",
      value: "/tmp/unsafe\npath\u001b[31m",
      plain: false,
    });

    expect(fitted.label).toBe("Download path");
    expect(fitted.value).toBe("/tmp/unsafepath");
    expect(fitted.value).not.toContain("\n");
  });

  test("uses the same sanitized value when the label is squeezed out", () => {
    const fitted = fitSettingsRowText({
      width: 12,
      prefix: "",
      label: "Download path",
      value: "/tmp/unsafe\npath",
      plain: false,
    });

    expect(fitted.label).toBe("");
    expect(fitted.value).not.toContain("\n");
  });
});
