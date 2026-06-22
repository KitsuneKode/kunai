import { describe, expect, test } from "bun:test";

import { buildReleaseNotesArtifact } from "../../../../../scripts/generate-release-notes.ts";
import {
  artifactWithoutBinaryChecksums,
  parseSha256sums,
  withBinaryChecksums,
} from "../../../../../scripts/release-binary-checksums.ts";

describe("parseSha256sums", () => {
  test("parses standard SHA256SUMS lines", () => {
    expect(
      parseSha256sums(`${"a".repeat(64)}  kunai-linux-x64
${"b".repeat(64)}  kunai-darwin-arm64
`),
    ).toEqual([
      { sha256: "a".repeat(64), name: "kunai-linux-x64" },
      { sha256: "b".repeat(64), name: "kunai-darwin-arm64" },
    ]);
  });
});

describe("release notes checksum merge", () => {
  test("strips assets for release:notes:check comparison", () => {
    const artifact = buildReleaseNotesArtifact({
      packageName: "@kitsunekode/kunai",
      version: "1.0.0",
      body: "Ship it.",
    });
    const withAssets = withBinaryChecksums(artifact, [
      { name: "kunai-linux-x64", sha256: "a".repeat(64) },
    ]);

    expect(artifactWithoutBinaryChecksums(withAssets)).toEqual(artifact);
  });
});
