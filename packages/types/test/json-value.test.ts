import { expect, test } from "bun:test";

import { isJsonString } from "../src/json-value";

test("string detection rejects malformed objects without coercing them", () => {
  expect(isJsonString(JSON.parse('{"toString":null}'))).toBe(false);
  expect(isJsonString(Object.create(null))).toBe(false);
});

test("string detection never invokes conversion hooks", () => {
  let conversions = 0;
  const value = {
    [Symbol.toPrimitive]() {
      conversions += 1;
      throw new Error("conversion must not run");
    },
  };
  expect(isJsonString(value)).toBe(false);
  expect(conversions).toBe(0);
});

test("only primitive strings pass the boundary", () => {
  expect(isJsonString("")).toBe(true);
  expect(isJsonString("🦊")).toBe(true);
  for (const value of [
    null,
    undefined,
    0,
    true,
    1n,
    Symbol("fixture"),
    new String("fixture"),
    [],
  ]) {
    expect(isJsonString(value)).toBe(false);
  }
});
