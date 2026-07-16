import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanupOrphanedDownloadTempFiles } from "@/services/download/DownloadService";

describe("orphaned download temp cleanup", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("deletes only Kunai UUID-suffixed temp artifacts", () => {
    const directory = mkdtempSync(join(tmpdir(), "kunai-temp-cleanup-"));
    directories.push(directory);
    const kunaiTemp = join(directory, "movie.mp4.tmp.123e4567-e89b-42d3-a456-426614174000");
    const preserved = [
      join(directory, "backup.tmp.old"),
      join(directory, "notes.tmp.txt"),
      join(directory, "movie.mp4.tmp.not-a-uuid"),
    ];
    for (const path of [kunaiTemp, ...preserved]) {
      writeFileSync(path, "data");
    }

    cleanupOrphanedDownloadTempFiles(directory);

    expect(existsSync(kunaiTemp)).toBe(false);
    expect(preserved.every((path) => existsSync(path))).toBe(true);
  });
});
