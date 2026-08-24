import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REQUIRED_RELEASE_ASSET_NAMES } from "../../../../../scripts/release-asset-contract";
import {
  verifyNativeAttestations,
  type AttestationCommandRunner,
} from "../../../../../scripts/verify-native-attestations";

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "kunai-native-attestations-"));
  for (const name of REQUIRED_RELEASE_ASSET_NAMES) {
    writeFileSync(join(directory, name), `payload:${name}\n`);
  }
  return directory;
}

describe("native release attestations", () => {
  test("verifies every exact release asset against the release workflow and source commit", () => {
    const directory = fixture();
    const calls: string[][] = [];
    const run: AttestationCommandRunner = (args) => {
      calls.push([...args]);
      return { status: 0, stdout: "verified", stderr: "" };
    };

    try {
      verifyNativeAttestations({
        directory,
        repository: "KitsuneKode/kunai",
        sourceDigest: "a".repeat(40),
        run,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    expect(calls).toHaveLength(REQUIRED_RELEASE_ASSET_NAMES.length);
    expect(calls.map((args) => args[2]?.split(/[\\/]/).at(-1))).toEqual(
      [...REQUIRED_RELEASE_ASSET_NAMES].sort(),
    );
    for (const args of calls) {
      expect(args.slice(0, 2)).toEqual(["attestation", "verify"]);
      expect(args).toContain("--repo");
      expect(args).toContain("KitsuneKode/kunai");
      expect(args).toContain("--signer-workflow");
      expect(args).toContain("KitsuneKode/kunai/.github/workflows/release.yml");
      expect(args).toContain("--source-digest");
      expect(args).toContain("a".repeat(40));
      expect(args).toContain("--source-ref");
      expect(args).toContain("refs/heads/main");
      expect(args).toContain("--deny-self-hosted-runners");
    }
  });

  test("fails closed when one asset has no valid attestation", () => {
    const directory = fixture();
    const run: AttestationCommandRunner = (args) => ({
      status: args[2]?.endsWith("kunai-linux-x64") ? 1 : 0,
      stdout: "",
      stderr: "no attestation found",
    });

    try {
      expect(() =>
        verifyNativeAttestations({
          directory,
          repository: "KitsuneKode/kunai",
          sourceDigest: "b".repeat(40),
          run,
        }),
      ).toThrow(/kunai-linux-x64.*no attestation found/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects unexpected files before trusting any attestation", () => {
    const directory = fixture();
    writeFileSync(join(directory, "surprise.bin"), "unexpected");
    let calls = 0;

    try {
      expect(() =>
        verifyNativeAttestations({
          directory,
          repository: "KitsuneKode/kunai",
          sourceDigest: "c".repeat(40),
          run: () => {
            calls += 1;
            return { status: 0, stdout: "", stderr: "" };
          },
        }),
      ).toThrow(/unexpected/i);
      expect(calls).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects malformed repository and source identities", () => {
    const directory = fixture();
    const run: AttestationCommandRunner = () => ({ status: 0, stdout: "", stderr: "" });

    try {
      expect(() =>
        verifyNativeAttestations({
          directory,
          repository: "not-a-repository",
          sourceDigest: "d".repeat(40),
          run,
        }),
      ).toThrow(/repository/i);
      expect(() =>
        verifyNativeAttestations({
          directory,
          repository: "KitsuneKode/kunai",
          sourceDigest: "main",
          run,
        }),
      ).toThrow(/source digest/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
