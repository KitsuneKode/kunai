import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  claimOwnedPartialPath,
  removeClaimOwnedPartial,
  shouldRetainDownloadPartials,
} from "@/services/download/download-partials";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pause and retry keep partials; abort and failure remove only the claim path", async () => {
  expect(shouldRetainDownloadPartials("pause")).toBe(true);
  expect(shouldRetainDownloadPartials("retry")).toBe(true);
  expect(shouldRetainDownloadPartials("abort")).toBe(false);
  expect(shouldRetainDownloadPartials("fail")).toBe(false);

  const dir = await mkdtemp(join(tmpdir(), "kunai-partials-"));
  dirs.push(dir);
  const tempPath = join(dir, "episode.mp4.part");
  const staging = `${tempPath}.claim-2`;
  const neighbor = join(dir, "neighbor.mp4");
  const target = join(dir, "real.mp4");
  const link = `${tempPath}.claim-3`;
  await writeFile(tempPath, "part");
  await mkdir(staging);
  await writeFile(join(staging, "fragment"), "frag");
  await writeFile(neighbor, "keep");
  await writeFile(target, "target");
  await symlink(target, link);

  expect(claimOwnedPartialPath(tempPath, join(dir, "..", "etc", "passwd"))).toBeUndefined();
  expect(await removeClaimOwnedPartial(tempPath, join(dir, "..", "neighbor.mp4"))).toBe("rejected");
  expect(await removeClaimOwnedPartial(tempPath, staging)).toBe("removed");
  expect(await removeClaimOwnedPartial(tempPath, link)).toBe("removed");
  expect(await removeClaimOwnedPartial(tempPath, tempPath)).toBe("removed");

  await expect(stat(neighbor)).resolves.toBeDefined();
  await expect(stat(target)).resolves.toBeDefined();
  await expect(stat(staging)).rejects.toThrow();
});
