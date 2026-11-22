import { expect, test } from "bun:test";

import { trimTrailingDots, trimTrailingSlashes } from "../src/shared/trim-trailing-slashes";

test("strips only trailing slashes", () => {
  expect(trimTrailingSlashes("https://a.example/api///")).toBe("https://a.example/api");
  expect(trimTrailingSlashes("https://a.example/api")).toBe("https://a.example/api");
  expect(trimTrailingSlashes("///")).toBe("");
  expect(trimTrailingSlashes("")).toBe("");
  // The CodeQL ReDoS shape: a long run of '/' followed by a non-slash. The
  // helper is a single backwards scan, so this is linear by construction.
  const hostile = `https://a.example/${"/".repeat(200_000)}x`;
  expect(trimTrailingSlashes(hostile)).toBe(hostile);
  expect(trimTrailingSlashes(`${hostile}//`)).toBe(hostile);
});

test("strips only trailing dots", () => {
  expect(trimTrailingDots("localhost.")).toBe("localhost");
  expect(trimTrailingDots("a.example..")).toBe("a.example");
  expect(trimTrailingDots(`${".".repeat(200_000)}x`)).toBe(`${".".repeat(200_000)}x`);
});
