import { expect, test } from "bun:test";

import {
  mintCompanionRunSecret,
  readSessionToken,
  validateCompanionRequestHost,
  validateCompanionRequestOrigin,
} from "@/services/web-companion/companion-session";

test("companion session secrets are 128-bit hex tokens", () => {
  expect(mintCompanionRunSecret()).toMatch(/^[0-9a-f]{32}$/);
});

test("companion host binding rejects foreign hosts and accepts loopback", () => {
  const expected = "127.0.0.1:4141";
  expect(validateCompanionRequestHost(new Request("http://127.0.0.1:4141/"), expected)).toBe(true);
  expect(
    validateCompanionRequestHost(
      new Request("http://localhost:4141/", { headers: { host: "localhost:4141" } }),
      expected,
    ),
  ).toBe(false);
  expect(
    validateCompanionRequestHost(
      new Request("http://evil.test/", { headers: { host: "evil.test" } }),
      expected,
    ),
  ).toBe(false);
});

test("companion origin checks refuse foreign origins on reads and writes", () => {
  const origin = "http://127.0.0.1:4141";
  expect(
    validateCompanionRequestOrigin(new Request("http://127.0.0.1:4141/api/status"), origin),
  ).toBe(true);
  expect(
    validateCompanionRequestOrigin(
      new Request("http://127.0.0.1:4141/api/session", {
        method: "POST",
        headers: { origin },
      }),
      origin,
    ),
  ).toBe(true);
  expect(
    validateCompanionRequestOrigin(
      new Request("http://127.0.0.1:4141/api/session", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:9999" },
      }),
      origin,
    ),
  ).toBe(false);
});

test("companion cookies ignore malformed values", () => {
  expect(
    readSessionToken(
      new Request("http://127.0.0.1:4141/", {
        headers: { cookie: "kunai_companion_session=short" },
      }),
    ),
  ).toBeNull();
  expect(
    readSessionToken(
      new Request("http://127.0.0.1:4141/", {
        headers: { cookie: `kunai_companion_session=${"a".repeat(32)}` },
      }),
    ),
  ).toBe("a".repeat(32));
});
