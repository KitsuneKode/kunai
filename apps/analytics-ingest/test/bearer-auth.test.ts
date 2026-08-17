import { expect, test } from "bun:test";

import { authorizeBearer, secretsMatch } from "../src/bearer-auth";

function request(authorization?: string) {
  return { headers: authorization === undefined ? {} : { authorization } } as never;
}

test("a matching secret is accepted", () => {
  expect(secretsMatch("s3cret", "s3cret")).toBe(true);
});

test("a wrong secret is refused whatever its length", () => {
  expect(secretsMatch("s3cret", "other")).toBe(false);
  // Differing lengths must not throw the way a bare timingSafeEqual would.
  expect(secretsMatch("short", "a much longer secret value")).toBe(false);
  expect(secretsMatch("s3cretX", "s3cret")).toBe(false);
});

test("an unset secret can never be matched", () => {
  // Otherwise a misconfigured deployment would authorize every caller.
  expect(secretsMatch("", "")).toBe(false);
  expect(secretsMatch("anything", "")).toBe(false);
  expect(secretsMatch("", "expected")).toBe(false);
});

test("a prefix of the real secret is refused", () => {
  expect(secretsMatch("s3cre", "s3cret")).toBe(false);
});

test("the bearer header is parsed case-insensitively and trimmed", () => {
  expect(authorizeBearer(request("Bearer tok"), "tok")).toBe(true);
  expect(authorizeBearer(request("bearer tok"), "tok")).toBe(true);
  expect(authorizeBearer(request("  Bearer   tok  "), "tok")).toBe(true);
});

test("a missing, malformed, or non-bearer header is refused", () => {
  expect(authorizeBearer(request(), "tok")).toBe(false);
  expect(authorizeBearer(request(""), "tok")).toBe(false);
  expect(authorizeBearer(request("tok"), "tok")).toBe(false);
  expect(authorizeBearer(request("Basic tok"), "tok")).toBe(false);
});

test("no header can authorize against an unconfigured secret", () => {
  expect(authorizeBearer(request("Bearer anything"), "")).toBe(false);
});
