import { expect, test } from "bun:test";

import { docsSiteUrlFrom } from "../lib/site";

test("unconfigured and preview builds keep the public canonical origin", () => {
  expect(docsSiteUrlFrom({})).toBe("https://kunai.kitsunekode.in");
  expect(docsSiteUrlFrom({ VERCEL_URL: "kunai-branch.vercel.app" })).toBe(
    "https://kunai.kitsunekode.in",
  );
});

test("explicit origins are normalized, but paths and credentials are rejected", () => {
  expect(docsSiteUrlFrom({ DOCS_SITE_URL: "https://docs.example.com/" })).toBe(
    "https://docs.example.com",
  );
  for (const value of [
    "https://docs.example.com/docs",
    "https://user:pass@example.com",
    "javascript:alert(1)",
  ]) {
    expect(() => docsSiteUrlFrom({ DOCS_SITE_URL: value })).toThrow();
  }
});
