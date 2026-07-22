import { describe, expect, test } from "bun:test";

import {
  type LocalPackageCandidate,
  reconcileCandidate,
} from "../../../../../scripts/npm-publication-plan";

const candidate: LocalPackageCandidate = {
  name: "@kitsunekode/kunai-linux-x64",
  version: "1.2.3",
  tarballPath: "/release/kunai-linux-x64.tgz",
  integrity: "sha512-local",
  role: "platform",
};

describe("npm publication reconciliation decisions", () => {
  test("publishes a package version that is absent from the registry", () => {
    expect(reconcileCandidate(candidate, null)).toEqual({ action: "publish", candidate });
  });

  test("skips a package version with identical integrity", () => {
    expect(reconcileCandidate(candidate, "sha512-local")).toEqual({
      action: "skip",
      candidate,
      registryIntegrity: "sha512-local",
    });
  });

  test("fails closed with package and version context when integrity differs", () => {
    expect(() => reconcileCandidate(candidate, "sha512-registry")).toThrow(
      /@kitsunekode\/kunai-linux-x64@1\.2\.3.*integrity/i,
    );
  });
});
