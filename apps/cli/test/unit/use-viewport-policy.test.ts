import { expect, test } from "bun:test";

import { sanitizeDimension } from "@/app-shell/use-viewport-policy";

test("sanitizeDimension keeps a valid positive dimension", () => {
  expect(sanitizeDimension(120, 80)).toBe(120);
  expect(sanitizeDimension(24, 24)).toBe(24);
});

test("sanitizeDimension falls back on 0 — the closed-terminal case that ?? misses", () => {
  // process.stdout.columns can report 0 when the terminal closes; `?? 80` would
  // keep the 0 and drive a zero-size render → the synchronous layout runaway.
  expect(sanitizeDimension(0, 80)).toBe(80);
  expect(sanitizeDimension(0, 24)).toBe(24);
});

test("sanitizeDimension falls back on undefined / NaN / negative", () => {
  expect(sanitizeDimension(undefined, 80)).toBe(80);
  expect(sanitizeDimension(Number.NaN, 80)).toBe(80);
  expect(sanitizeDimension(-10, 80)).toBe(80);
  expect(sanitizeDimension(Number.POSITIVE_INFINITY, 80)).toBe(80);
});

test("sanitizeDimension floors fractional values", () => {
  expect(sanitizeDimension(119.7, 80)).toBe(119);
});
