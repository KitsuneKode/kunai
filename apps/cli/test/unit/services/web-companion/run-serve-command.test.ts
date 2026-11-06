import { expect, test } from "bun:test";

import { parseServeArgs } from "@/services/web-companion/run-serve-command";

test("companion defaults to numeric loopback on its own device", () => {
  expect(parseServeArgs([])).toEqual({ port: 4141, host: "127.0.0.1" });
  expect(parseServeArgs(["--host", "localhost", "--port", "8080"])).toEqual({
    port: 8080,
    host: "127.0.0.1",
  });
});

test("companion refuses LAN binding and malformed ports before bootstrap", () => {
  for (const args of [
    ["--host", "0.0.0.0"],
    ["--port", "999999"],
    ["--port", "8080oops"],
    ["--port"],
    ["--host", "example.test"],
  ]) {
    expect(() => parseServeArgs(args)).toThrow();
  }
});
