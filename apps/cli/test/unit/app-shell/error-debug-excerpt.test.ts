import { describe, expect, test } from "bun:test";

import { extractErrorDebugExcerpt } from "@/app-shell/error-debug-excerpt";

describe("extractErrorDebugExcerpt", () => {
  test("returns message and first stack frame from Error objects", () => {
    const error = new Error("provider resolve failed");
    error.stack = ["Error: provider resolve failed", "    at resolve (/tmp/foo.ts:12:3)"].join(
      "\n",
    );

    expect(extractErrorDebugExcerpt(error)).toEqual({
      message: "provider resolve failed",
      topFrame: "at resolve (/tmp/foo.ts:12:3)",
    });
  });

  test("returns null for non-error values", () => {
    expect(extractErrorDebugExcerpt("plain string")).toBeNull();
    expect(extractErrorDebugExcerpt(null)).toBeNull();
  });
});
