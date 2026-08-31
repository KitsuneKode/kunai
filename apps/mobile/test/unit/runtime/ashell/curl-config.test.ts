import { describe, expect, test } from "bun:test";

import { encodeCurlConfig } from "../../../../src/runtime/ashell/curl-config";

const REQUEST = {
  method: "GET",
  url: 'https://probe.example/a path/\\quote"?token=secret&x=$(touch%20nope);done',
  timeoutMs: 8_000,
  maxBytes: 65_536,
} as const;

describe("a-Shell curl config", () => {
  test("encodes a bounded GET without shell interpolation", () => {
    const config = encodeCurlConfig(REQUEST);

    expect(config).toContain(
      'url = "https://probe.example/a%20path//quote%22?token=secret&x=$(touch%20nope);done"',
    );
    expect(config).toContain("max-time = 8");
    expect(config).toContain("max-filesize = 65536");
    expect(config).toContain('request = "GET"');
    expect(config).not.toContain("\r");
    expect(config).not.toContain("\0");
  });

  test("rejects config-breaking controls and non-portable URLs", () => {
    for (const url of [
      "https://x.example/\r\noutput=/tmp/pwn",
      "https://x.example/a\0b",
      "file:///private/probe",
      "https://user:secret@x.example/probe",
      "https://x.example/probe#fragment",
    ]) {
      expect(() => encodeCurlConfig({ ...REQUEST, url })).toThrow("HTTP(S)");
    }
  });

  test("rejects invalid deadlines and response caps", () => {
    expect(() => encodeCurlConfig({ ...REQUEST, timeoutMs: 0 })).toThrow("timeout");
    expect(() => encodeCurlConfig({ ...REQUEST, maxBytes: -1 })).toThrow("response cap");
  });
});
