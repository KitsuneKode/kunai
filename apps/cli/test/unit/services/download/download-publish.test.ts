import { describe, expect, test } from "bun:test";
import { constants as fsConstants } from "node:fs";

import {
  publishStagedDownloadArtifact,
  type StagedDownloadPublishFs,
} from "@/services/download/DownloadService";

type StubCalls = {
  link: number;
  copyFlags: Array<number | undefined>;
  fsynced: string[];
  removed: string[];
};

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function buildStub(behavior: {
  readonly linkError?: NodeJS.ErrnoException;
  readonly copyError?: NodeJS.ErrnoException;
  readonly fsyncError?: Error;
}) {
  const calls: StubCalls = { link: 0, copyFlags: [], fsynced: [], removed: [] };
  const fs: StagedDownloadPublishFs = {
    link: async () => {
      calls.link += 1;
      if (behavior.linkError) throw behavior.linkError;
    },
    copyFile: async (_src, _dest, flags) => {
      calls.copyFlags.push(flags);
      if (behavior.copyError) throw behavior.copyError;
    },
    fsyncFile: async (path) => {
      calls.fsynced.push(path);
      if (behavior.fsyncError) throw behavior.fsyncError;
    },
    removeFile: async (path) => {
      calls.removed.push(path);
    },
  };
  return { fs, calls };
}

describe("publishStagedDownloadArtifact", () => {
  test("hard-links when the volume supports it", async () => {
    const { fs, calls } = buildStub({});
    await expect(publishStagedDownloadArtifact("/tmp/a.tmp", "/dl/a.mp4", fs)).resolves.toBe(
      "hard-linked",
    );
    expect(calls.link).toBe(1);
    expect(calls.copyFlags).toEqual([]);
  });

  test("falls back to exclusive copy+fsync+unlink on cross-device EXDEV", async () => {
    const { fs, calls } = buildStub({ linkError: errno("EXDEV") });
    await expect(publishStagedDownloadArtifact("/tmp/a.tmp", "/mnt/exfat/a.mp4", fs)).resolves.toBe(
      "copied",
    );
    // COPYFILE_EXCL: the fallback must fail rather than silently overwrite.
    expect(calls.copyFlags).toEqual([fsConstants.COPYFILE_EXCL]);
    expect(calls.fsynced).toEqual(["/mnt/exfat/a.mp4"]);
    expect(calls.removed).toEqual(["/tmp/a.tmp"]);
  });

  test("never overwrites an existing destination (link EEXIST)", async () => {
    const { fs, calls } = buildStub({ linkError: errno("EEXIST") });
    await expect(publishStagedDownloadArtifact("/tmp/a.tmp", "/dl/a.mp4", fs)).rejects.toThrow(
      /already exists; existing file preserved/,
    );
    expect(calls.copyFlags).toEqual([]);
  });

  test("never overwrites an existing destination (copy EEXIST)", async () => {
    const { fs, calls } = buildStub({
      linkError: errno("EXDEV"),
      copyError: errno("EEXIST"),
    });
    await expect(
      publishStagedDownloadArtifact("/tmp/a.tmp", "/mnt/exfat/a.mp4", fs),
    ).rejects.toThrow(/already exists; existing file preserved/);
    expect(calls.fsynced).toEqual([]);
    expect(calls.removed).toEqual([]);
  });

  test("removes the partial copy when fsync fails", async () => {
    const { fs, calls } = buildStub({
      linkError: errno("EXDEV"),
      fsyncError: new Error("fsync failed"),
    });
    await expect(
      publishStagedDownloadArtifact("/tmp/a.tmp", "/mnt/exfat/a.mp4", fs),
    ).rejects.toThrow("fsync failed");
    expect(calls.removed).toEqual(["/mnt/exfat/a.mp4"]);
  });
});
