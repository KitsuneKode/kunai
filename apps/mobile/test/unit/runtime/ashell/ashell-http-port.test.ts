import { describe, expect, test } from "bun:test";

import { createAShellCommandBridge } from "../../../../src/runtime/ashell/ashell-command-bridge";
import type { AShellJsc } from "../../../../src/runtime/ashell/ashell-globals";
import { createAShellHttpPort } from "../../../../src/runtime/ashell/ashell-http-port";

const REQUEST = {
  method: "GET",
  url: "https://probe.example/status?token=secret&x=$(touch%20nope)",
  timeoutMs: 8_000,
  maxBytes: 65_536,
} as const;

function httpFixture(input: { readonly status?: number | string; readonly metadata?: string }) {
  const files = new Map<string, string>();
  const systemCommands: string[] = [];
  const jsc: AShellJsc = {
    readFile(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing file");
      return value;
    },
    writeFile(path, value) {
      files.set(path, value);
      return 0;
    },
    isFile: (path) => files.has(path),
    makeFolder: () => 0,
    deleteFile(path) {
      files.delete(path);
      return 0;
    },
    move: () => 0,
    system(command) {
      systemCommands.push(command);
      if ((input.status ?? 0) === 0 || (input.status ?? 0) === "0") {
        files.set(".runtime/http-body", "hello");
        files.set(".runtime/http-meta", input.metadata ?? "204\n5\n");
      }
      return input.status ?? "0";
    },
  };
  return {
    files,
    systemCommands,
    port: createAShellHttpPort({ jsc, bridge: createAShellCommandBridge(jsc) }),
  };
}

describe("a-Shell HTTP port", () => {
  test("runs one fixed helper and removes all request and response files", async () => {
    const fixture = httpFixture({});

    await expect(fixture.port.request(REQUEST)).resolves.toEqual({ status: 204, bytes: 5 });
    expect(fixture.systemCommands).toEqual(["./kunai-mobile-http"]);
    expect(fixture.systemCommands[0]).not.toContain(REQUEST.url);
    expect(JSON.stringify([...fixture.files])).not.toContain("secret");
    expect(fixture.files.size).toBe(0);
  });

  test("fails closed on helper errors, malformed metadata, and oversized bodies", async () => {
    for (const fixture of [
      httpFixture({ status: 28 }),
      httpFixture({ metadata: "not-status\n5\n" }),
      httpFixture({ metadata: "200\n65537\n" }),
    ]) {
      await expect(fixture.port.request(REQUEST)).rejects.toThrow("HTTP probe failed");
      expect(JSON.stringify([...fixture.files])).not.toContain("secret");
      expect(fixture.files.size).toBe(0);
    }
  });
});
