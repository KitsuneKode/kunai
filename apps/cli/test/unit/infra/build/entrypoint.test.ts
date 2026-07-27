import { describe, expect, test } from "bun:test";

import { isProcessEntrypoint, normalizeEntrypointPath } from "@/infra/build/entrypoint";

/** Minimal stand-in for the two `ImportMeta` fields the guard reads. */
function meta(main: boolean, path: string): ImportMeta {
  return { main, path } as unknown as ImportMeta;
}

describe("normalizeEntrypointPath", () => {
  test("folds separators and case so Windows spellings compare equal", () => {
    expect(normalizeEntrypointPath("B:\\~BUN\\root\\main.js")).toBe("b:/~bun/root/main.js");
    expect(normalizeEntrypointPath("B:/~BUN/root/main.js")).toBe("b:/~bun/root/main.js");
  });

  test("leaves an already-normalised POSIX path alone", () => {
    expect(normalizeEntrypointPath("/home/u/kunai/src/main.ts")).toBe("/home/u/kunai/src/main.ts");
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
      isProcessEntrypoint(meta(false, "B:\\~BUN\\root\\main.js"), "B:/~BUN/root/main.js"),
    ).toBe(true);
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
