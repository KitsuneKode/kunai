import { describe, expect, test } from "bun:test";

import {
  RELEASE_ARTIFACT_SCHEMA_VERSION,
  transitionReleaseStatus,
  type ReleaseNotesArtifact,
} from "../../../../../scripts/release-artifact.ts";

const STAGED_WITH_ASSETS: ReleaseNotesArtifact = {
  schemaVersion: RELEASE_ARTIFACT_SCHEMA_VERSION,
  status: "staged",
  publishedAt: null,
  packageName: "@kitsunekode/kunai",
  version: "0.3.0",
  tag: "v0.3.0",
  title: "Kunai 0.3.0",
  date: null,
  summary: "A staged release.",
  sections: [],
  changelogBody: "A staged release.",
  install: {
    npm: "npm install -g @kitsunekode/kunai@0.3.0",
    bunx: "bunx @kitsunekode/kunai@0.3.0",
    binaryLatest: "https://github.com/KitsuneKode/kunai/releases/latest",
  },
  assets: [{ name: "kunai-linux-x64", sha256: "a".repeat(64) }],
};

const PUBLISHED: ReleaseNotesArtifact = {
  ...STAGED_WITH_ASSETS,
  status: "published",
  publishedAt: "2026-07-01T00:00:00Z",
  assets: undefined,
};

describe("transitionReleaseStatus", () => {
  test("publishes a staged artifact and retains assets", () => {
    expect(
      transitionReleaseStatus(STAGED_WITH_ASSETS, "published", "2026-07-20T12:00:00Z"),
    ).toMatchObject({
      status: "published",
      publishedAt: "2026-07-20T12:00:00Z",
      assets: STAGED_WITH_ASSETS.assets,
    });
  });

  test("published artifacts cannot regress to staged", () => {
    expect(() => transitionReleaseStatus(PUBLISHED, "staged")).toThrow(
      "published release cannot return to staged",
    );
  });
});
