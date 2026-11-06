import { expect, test } from "bun:test";

import { getLocalIpv4Addresses, parseServeArgs } from "@/services/web-companion/run-serve-command";

test("parseServeArgs parses port and host correctly", () => {
  const defaults = parseServeArgs([]);
  expect(defaults.port).toBe(4141);
  expect(defaults.host).toBe("0.0.0.0");

  const custom = parseServeArgs(["--port", "8080", "--host", "127.0.0.1"]);
  expect(custom.port).toBe(8080);
  expect(custom.host).toBe("127.0.0.1");

  const shortFlags = parseServeArgs(["-p", "9090", "-h", "192.168.1.10"]);
  expect(shortFlags.port).toBe(9090);
  expect(shortFlags.host).toBe("192.168.1.10");

  const invalidPort = parseServeArgs(["--port", "999999"]);
  expect(invalidPort.port).toBe(4141);
});

test("getLocalIpv4Addresses returns non-empty array or empty on isolated networks", () => {
  const addresses = getLocalIpv4Addresses();
  expect(Array.isArray(addresses)).toBe(true);
  for (const addr of addresses) {
    expect(addr.length).toBeGreaterThan(0);
    expect(addr).not.toBe("127.0.0.1");
  }
});
