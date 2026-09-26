import { describe, expect, test } from "bun:test";

import {
  assertInvocationBinary,
  resolveDefaultInvocation,
} from "../../../../../scripts/verify-readme-commands";
import cliPackage from "../../../package.json";
import { RELEASE_BINARY_TARGETS } from "../../../src/services/update/platform-assets";

// #471: `bun run verify:readme:commands` used to print usage and exit 2 —
// the root script passes no arguments, so the only invocation a developer
// ever made was the one the gate never exercised. These pin the defaults
// that bare invocation now resolves.

describe("verify-readme-commands defaults", () => {
  test("no-arg invocation resolves fixture mode, the CLI version, and the host binary", async () => {
    const invocation = await resolveDefaultInvocation();

    expect(invocation.mode).toBe("fixture-assets");
    expect(invocation.version).toBe(cliPackage.version);
    expect(invocation.binary.startsWith("apps/cli/dist/bin/")).toBe(true);
    // The resolved name is one of the release targets, not a hand-rolled guess.
    const names = RELEASE_BINARY_TARGETS.map((target) => target.out);
    expect(names).toContain(invocation.binary.slice("apps/cli/dist/bin/".length));
  });

  test("a missing host binary fails with the build instruction, not a usage dump", () => {
    expect(() =>
      assertInvocationBinary("apps/cli/dist/bin/definitely-absent", "/nonexistent-root"),
    ).toThrow(/build:binary:host/);
  });
});
