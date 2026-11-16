import { expect, test } from "bun:test";

import {
  mintCompanionRunSecret,
  readCompanionCredential,
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

test("credentials are explicit and never recovered from a cross-port cookie", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://127.0.0.1:4141/", { headers });
  expect(
    readCompanionCredential(request({ cookie: `kunai_companion_session=${"a".repeat(32)}` })),
  ).toBeNull();
  expect(readCompanionCredential(request({ authorization: "Bearer short" }))).toBeNull();
  expect(readCompanionCredential(request({ authorization: `Bearer ${"a".repeat(32)}` }))).toBe(
    "a".repeat(32),
  );
});

test("default-port canonicalization admits only the numeric bound authority", () => {
  for (const host of ["127.0.0.1", "127.0.0.1:80"]) {
    expect(
      validateCompanionRequestHost(
        new Request("http://127.0.0.1/api/status", { headers: { host } }),
        "127.0.0.1",
      ),
    ).toBe(true);
  }
  for (const host of [
    "localhost",
    "localhost:80",
    "127.0.0.1:81",
    "127.0.0.1/",
    "user@127.0.0.1",
    "127.0.0.1:",
  ]) {
    expect(
      validateCompanionRequestHost(
        new Request("http://127.0.0.1/api/status", { headers: { host } }),
        "127.0.0.1",
      ),
    ).toBe(false);
  }
});
