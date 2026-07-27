import { describe, expect, test } from "bun:test";

import { isProcessEntrypoint, normalizeEntrypointPath } from "@/infra/build/entrypoint";

/** Minimal stand-in for the two `ImportMeta` fields the guard reads. */
function meta(main: boolean, path: string): ImportMeta {
  return { main, path } as unknown as ImportMeta;
}

describe("normalizeEntrypointPath", () => {
  test("folds separators and case so Windows spellings compare equal", () => {
    expect(normalizeEntrypointPath("B:\\~BUN\\root\\main.js", "win32")).toBe(
      "b:/~bun/root/main.js",
    );
    expect(normalizeEntrypointPath("B:/~BUN/root/main.js", "win32")).toBe("b:/~bun/root/main.js");
  });

  test("keeps POSIX case and legal backslashes significant", () => {
    expect(normalizeEntrypointPath("/home/U/kunai\\main.ts", "linux")).toBe(
      "/home/U/kunai\\main.ts",
    );
  });
});

describe("isProcessEntrypoint", () => {
  test("trusts import.meta.main when Bun already said yes", () => {
    expect(isProcessEntrypoint(meta(true, "/anywhere/main.ts"))).toBe(true);
  });

  test("recognises the entry module when only the separators differ", () => {
    // The exact shape seen inside a compiled Windows binary: Bun.main uses
    // forward slashes, import.meta.path uses backslashes, and import.meta.main
    // is wrongly false. Without this the CLI exits 0 having printed nothing.
    expect(
      isProcessEntrypoint(meta(false, "B:\\~BUN\\root\\main.js"), "B:/~BUN/root/main.js", "win32"),
    ).toBe(true);
  });

  test("does not apply Windows path identity rules on POSIX", () => {
    expect(
      isProcessEntrypoint(meta(false, "/opt/Kunai/main.ts"), "/opt/kunai/main.ts", "linux"),
    ).toBe(false);
    expect(
      isProcessEntrypoint(meta(false, "/opt/kunai\\main.ts"), "/opt/kunai/main.ts", "linux"),
    ).toBe(false);
  });

  test("stays false for a module that is merely imported", () => {
    expect(
      isProcessEntrypoint(
        meta(false, "B:\\~BUN\\root\\services\\other.js"),
        "B:/~BUN/root/main.js",
      ),
    ).toBe(false);
  });

  test("stays false when the main specifier is unavailable", () => {
    expect(isProcessEntrypoint(meta(false, "B:\\~BUN\\root\\main.js"), "")).toBe(false);
  });
});
